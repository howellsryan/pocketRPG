// One co-operative boss fight, as a Durable Object.
//
// Migration 0031 ran the tick loop over D1: every member polled
// /api/coop/session/:id/tick, whichever request arrived first inside the 600ms
// window advanced the fight, and the losers threw their work away. That model
// had two problems no amount of SQL fixed.
//
//   Correctness. The kill settlement — rolling the drop table, granting it,
//   bumping the kill count — ran BEFORE the optimistic-concurrency write that
//   decided whether the tick counted. Eight members polling into one window
//   meant several requests computed the same kill, and because settling takes
//   several D1 round-trips, a request arriving a few milliseconds later read
//   the already-settled revision and granted the drop a second time.
//
//   Cost. Each tick was a read and a write of a state blob holding eight
//   members' full inventories, at ~1.7Hz per room, against single-writer SQLite.
//
// A DO fixes both by construction: one room, one thread, state in memory, and
// the fight advanced by the room's own clock rather than by whoever polled
// first. D1 is touched on join, leave, kill settlement and a periodic
// checkpoint — never on an ordinary tick.
//
// The save is still written only through functions/_lib/game/coopBoss.js, the
// same way world/server/grants.ts is the world's only save writer.

import {
  COOP_MAX_MEMBERS,
  addCoopMember,
  processCoopTick,
  memberCount,
  removeCoopMember,
} from '../../src/engine/coopBossEngine.js'
import { setQuestGateBypass, resolveQuestGateBypass } from '../../src/engine/questGates.js'
import { coopEpicDropEvents } from '../../src/engine/lootBroadcast.js'
import { chatRateVerdict, sanitizeChat } from '../../src/engine/playerChat.js'
import {
  COOP_FRAME_ACK,
  COOP_FRAME_BYE,
  COOP_FRAME_NACK,
  COOP_FRAME_PONG,
  COOP_FRAME_SYNC,
  COOP_FRAME_TICK,
  COOP_SOCKET_LINGER_MS,
  deltaWorthSending,
  projectionDelta,
} from '../../src/engine/coopSocketProtocol.js'
import { validateCoopAction } from '../../functions/_lib/game/coopIntent.js'
import { auditLog } from '../../functions/_lib/game/audit.js'
import itemsData from '../../src/data/items.json'
import monstersData from '../../src/data/monsters.json'
import {
  COOP_ENGINE_DEPS,
  COOP_SESSION_STALE_MS,
  parseSessionState,
  readSession,
  settleCoopKill,
  writeBackMember,
} from '../../functions/_lib/game/coopBoss.js'
import {
  eventsSince,
  projectEventsForMember,
  projectStateForMember,
  pushEvents,
  staleMemberIds,
} from '../../functions/_lib/game/coopProjection.js'
import { revokeOneLifeIfSet } from './oneLife'
import type { Env } from './env'

const TICK_MS = 600
/** How often the live fight is mirrored back to D1. The room is the authority
 * while it lives; the checkpoint exists so the crash sweep has something recent
 * to write members back from. Deliberately NOT lengthened to save writes — the
 * cost of a longer interval is a player's lost progress when a DO is evicted
 * mid-fight, which is worth more than the row it saves. */
const CHECKPOINT_EVERY_TICKS = 25
/** A lobby is not a fight: nothing is at risk, so mirroring it every 15s is
 * pure write cost for a party standing still. Membership, readiness and phase
 * changes still force an immediate checkpoint, so the lobby list stays honest. */
const LOBBY_CHECKPOINT_EVERY_TICKS = 100
/** A member's heartbeat row only has to stay fresher than COOP_SESSION_STALE_MS
 * (90s), because that is what /api/save reads to decide their save is locked.
 * Writing it on every checkpoint spent a row per member per 15s to prove
 * something 30s of margin already proves. */
const HEARTBEAT_WRITE_EVERY_MS = 30_000
/** A socket may send this many frames per window before the room stops
 * believing it is a game client. The intent queue is capped separately (that
 * cap is about the fight); this one is about the room's CPU. */
const SOCKET_FRAME_WINDOW_MS = 10_000
const SOCKET_FRAME_MAX_IN_WINDOW = 120
/** A member may have this many actions waiting for the next beat. The room is
 * single-threaded so there is no table to contend on any more — this only stops
 * a client spending the room's memory. */
const MAX_PENDING_INTENTS_PER_MEMBER = 4
/** Chat is capped on its own clock rather than against the combat queue: a
 * player talking must never eat the action slots they need to eat and pray, and
 * a player fighting must never be silenced by their own swings. */
const CHAT_RATE_WINDOW_MS = 10_000
const CHAT_RATE_MAX_IN_WINDOW = 8

type AnyState = Record<string, any>
type QueuedIntent = { tick_number: number; characterId: number; characterSeq: number; action: unknown }
/**
 * One live client connection.
 *
 * `projection` is the baseline every delta is measured from, and it is per
 * SOCKET rather than per member on purpose: a reconnect can briefly leave two
 * sockets on one character, and sharing a baseline would send the second one
 * deltas against a state it has never seen.
 */
type Conn = {
  key: string
  projection: AnyState | null
  ackTick: number
  frameTimes: number[]
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export class CoopBossRoom {
  private state: AnyState | null = null
  private sessionId = 0
  private bossId = ''
  private raidId: string | null = null
  private killSeq = 0
  /**
   * The last tick the room will admit to. A tick is only published once
   * everything belonging to it exists — settlement included — because a client
   * that acknowledges a tick can never be shown anything appended to it
   * afterwards. Kills are settled across several D1 round-trips per winner, so
   * without this a poll landing mid-settlement acknowledged the tick and the
   * loot event was filtered out of every poll that followed.
   */
  private publishedTick = 0
  private events: AnyState[] = []
  private lastSeen: Record<string, number> = {}
  private pending: QueuedIntent[] = []
  /** Chat said between beats, drained by the tick. Queued rather than appended
   * on arrival because an event added to a tick a client has already
   * acknowledged is filtered out by `> since` forever — the same rule that
   * keeps settlement off the tick it settles. */
  private pendingChat: AnyState[] = []
  /** Characters whose One Life run this room has to end, drained by the tick.
   * A member is never revived inside a session, so this fills at most once per
   * member per fight — it is a retry queue for a failed D1 write, not a
   * per-tick write path. */
  private pendingOneLifeDeaths = new Set<number>()
  private chatTimes: Record<string, number[]> = {}
  /** Live push connections. A member with an entry here is proving they are
   * present on every beat, so they never reach the 90s poll-staleness path. */
  private conns = new Map<WebSocket, Conn>()
  /** When each member's heartbeat row was last written, so the checkpoint can
   * refresh it on its own 30s clock instead of on every 15s checkpoint. */
  private heartbeatWrittenAt: Record<string, number> = {}
  private intentSeq = 0
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private loading: Promise<void> | null = null
  private dirty = false
  private lastCheckpointTick = 0
  /** The phase the D1 row was last told about. A raid party setting off has to
   * stop being advertised as joinable NOW, not at the next periodic checkpoint
   * — the lobby list is read from the row, so a 25-tick lag is 15 seconds of
   * offering people a run they cannot enter. */
  private checkpointedPhase = ''
  private busy = false
  /** When the last beat ran. Sent to clients as the time LEFT of the current
   * beat so they can poll in step with the fight instead of drifting a round
   * trip further out of phase with every request. */
  private lastTickAt = Date.now()
  private queue: Promise<unknown> = Promise.resolve()
  private env: Env

  /**
   * Serialises everything that REPLACES this.state.
   *
   * addCoopMember/removeCoopMember clone the state, so the member objects in
   * the new state are new objects. A swap landing inside a tick's await —
   * settlement is several D1 round-trips — leaves that tick mutating members
   * nobody can see any more: the loot winner's granted inventory and their
   * bumped saveRevision are written to the orphan, so the drop is silently
   * dropped and their next write-back is refused as diverged.
   */
  private runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.catch(() => {})
    return next
  }

  constructor(_ctx: DurableObjectState, env: Env) {
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    // A cross-script DO call never runs the Worker's own fetch handler, so the
    // preview quest-gate bypass has to be installed in this isolate too.
    setQuestGateBypass(resolveQuestGateBypass(this.env, request.url))
    const url = new URL(request.url)
    const action = url.pathname.split('/').filter(Boolean).pop()
    // A socket upgrade is a GET and carries no body, so its parameters ride the
    // query string the Pages proxy built after it checked the ticket.
    const body = action === 'socket'
      ? Object.fromEntries(url.searchParams) as Record<string, any>
      : await request.json().catch(() => ({})) as Record<string, any>
    // Answered before any session lookup, so the Pages side can ask an
    // arbitrary room object what this Worker understands. Pages and the world
    // Worker deploy separately, and a Pages build that knows about raids
    // talking to a Worker that does not is not a harmless mismatch: the old
    // room ignores `state.raid`, so it respawns the raid's FIRST boss forever
    // and settles each kill against that boss's drop table.
    if (action === 'capabilities') return jsonResponse({ ok: true, raids: true, sockets: true })

    const sessionId = Number(body?.sessionId)
    const characterId = Number(body?.characterId)
    if (!Number.isInteger(sessionId) || sessionId <= 0) return jsonResponse({ error: 'invalid_session' }, 400)
    if (!Number.isInteger(characterId) || characterId <= 0) return jsonResponse({ error: 'invalid_character' }, 400)

    await this.ensureLoaded(sessionId)
    if (!this.state) return jsonResponse({ error: 'coop_session_not_found' }, 404)

    const key = String(characterId)
    // `join` is what MAKES someone a member, so it has to run before the
    // membership gate — everything else is gated.
    if (action === 'join') return this.handleJoin(key, body)
    if (!this.state.members?.[key]) return jsonResponse({ error: 'not_a_member' }, 403)

    switch (action) {
      case 'poll': return this.handlePoll(key, body)
      case 'intent': return this.handleIntent(key, body)
      case 'socket': return this.handleSocket(key, request, body)
      case 'depart': return this.handleDepart(key)
      default: return jsonResponse({ error: 'unknown_action' }, 404)
    }
  }

  /**
   * Adds a member to a fight that is already running.
   *
   * This exists because the room, not D1, is the authority on who is in a
   * fight. joinCoopSession used to write the new member into the session's
   * state_json and stop there — which worked only while the room was cold. A
   * warm room never re-reads D1 (ensureLoaded short-circuits) and overwrites
   * state_json on its next checkpoint, so the joiner was dropped and every poll
   * they made answered `not_a_member`. Only whoever opened the session could
   * actually fight.
   *
   * The member cap is enforced here for the same reason: D1's member_count is a
   * mirror this room writes, so a cap checked against it is checked against
   * stale data. A caller that picked a full room gets `session_full` and tries
   * the next one.
   */
  private handleJoin(key: string, body: Record<string, any>): Promise<Response> {
    return this.runExclusive(async () => {
      if (!this.state) return jsonResponse({ error: 'coop_session_not_found' }, 404)
      // Idempotent: a cold room has already loaded this member from the row the
      // caller just wrote, and a retried request must not re-seed their combat
      // state (it would re-arm timers and reset accrued damage).
      if (this.state.members?.[key]) {
        this.lastSeen[key] = Date.now()
        this.startTicking()
        return jsonResponse({ ok: true, alreadyPresent: true, tick: this.state.tick || 0 })
      }
      const member = body?.member
      if (!member || typeof member !== 'object' || String(member.characterId) !== key || !member.combat) {
        return jsonResponse({ error: 'invalid_member' }, 400)
      }
      if (memberCount(this.state) >= COOP_MAX_MEMBERS) return jsonResponse({ error: 'session_full' }, 409)
      // A raid is a run with a beginning. The room is the only thing that knows
      // whether the host has pressed Start — the D1 row is a checkpoint behind —
      // so the lobby gate has to be enforced here, not just in the join path.
      if (this.state.raid && this.state.phase !== 'lobby') {
        return jsonResponse({ error: 'raid_in_progress' }, 409)
      }

      const joined = addCoopMember(this.state, member) as AnyState
      this.state = joined
      this.lastSeen[key] = Date.now()
      this.dirty = true
      this.startTicking()
      const tick = joined.tick || 0
      // Checkpoint before answering: the caller stamps the save lock on the
      // strength of this reply, and a room evicted before its next periodic
      // checkpoint would otherwise come back without them.
      await this.checkpoint(Date.now())
      return jsonResponse({ ok: true, tick })
    })
  }

  /** Hydrates the room from D1 the first time anyone reaches it (a cold DO, or
   * one evicted between fights) and starts the clock. */
  private async ensureLoaded(sessionId: number): Promise<void> {
    if (this.state && this.sessionId === sessionId) return
    if (this.loading) return this.loading
    this.loading = (async () => {
      const row = await readSession(this.env as never, sessionId) as AnyState | null
      if (!row || row.status !== 'active') {
        this.state = null
        return
      }
      this.state = parseSessionState(row)
      this.sessionId = sessionId
      this.bossId = row.boss_id
      this.raidId = row.raid_id ?? null
      this.lastCheckpointTick = Number(this.state?.tick) || 0
      this.publishedTick = Number(this.state?.tick) || 0
      this.checkpointedPhase = String(row.phase || this.state?.phase || 'active')

      // Seed killSeq from the settlement table, not the session row: a DO
      // evicted between granting a kill and checkpointing would otherwise come
      // back a sequence behind and burn the next kill's grant on a replay.
      const settled = await this.env.DB.prepare(
        'SELECT MAX(kill_seq) AS seq FROM coop_kill_settlements WHERE session_id = ?',
      ).bind(sessionId).first<{ seq: number | null }>()
      this.killSeq = Math.max(Number(row.kill_seq) || 0, Number(settled?.seq) || 0)

      // Seed each member's heartbeat from their OWN stored value rather than
      // `now`. Restoring them all as freshly-seen means one live player's poll
      // revives a crashed player's lock every time the room reloads, which is
      // exactly the lockout the per-member clock exists to prevent.
      const seen = await this.env.DB.prepare(
        'SELECT character_id, last_seen_at FROM coop_session_members WHERE session_id = ? AND left_at IS NULL',
      ).bind(sessionId).all<{ character_id: number; last_seen_at: number | null }>()
      const seenBy = new Map((seen.results || []).map((r) => [String(r.character_id), Number(r.last_seen_at) || 0]))
      for (const id of Object.keys(this.state?.members || {})) this.lastSeen[id] = seenBy.get(id) ?? 0
      this.startTicking()
    })()
    try { await this.loading } finally { this.loading = null }
  }

  private startTicking(): void {
    if (this.tickTimer) return
    this.lastTickAt = Date.now()
    this.tickTimer = setInterval(() => { void this.tick() }, TICK_MS)
  }

  private stopTicking(): void {
    if (!this.tickTimer) return
    clearInterval(this.tickTimer)
    this.tickTimer = null
  }

  /**
   * One 600ms beat of the fight, driven by the room's own clock — so the boss
   * swings at a steady rate whether eight clients are polling or none is. Under
   * the old model a room where everyone had lag simply ran slower.
   *
   * `busy` guards re-entry while an await is outstanding: settlement and
   * write-backs hit D1, and a second beat landing mid-grant is exactly the race
   * the DO exists to remove.
   */
  private async tick(): Promise<void> {
    if (!this.state || this.busy) return
    this.busy = true
    // `busy` skips a beat that arrives while one is still running; the queue
    // additionally keeps joins and departures out of the middle of it.
    return this.runExclusive(() => this.tickInner()).finally(() => { this.busy = false })
  }

  private async tickInner(): Promise<void> {
    try {
      const now = Date.now()
      this.lastTickAt = now
      await this.ejectStaleMembers(now)
      if (!this.state) return
      if (memberCount(this.state) === 0) {
        await this.closeRoom(now)
        return
      }

      const intents = this.pending
      this.pending = []
      const out = processCoopTick(this.state, intents, COOP_ENGINE_DEPS, now)
      const next = out.stateNext as AnyState
      this.state = next
      const chat = this.pendingChat.map((ev) => ({ ...ev, tick: next.tick }))
      this.pendingChat = []
      this.events = pushEvents(this.events, [...out.events, ...chat], next.tick)
      this.dirty = true
      await this.endOneLifeRuns(out.events, next.tick || 0)

      // Settlement runs AFTER the tick is committed to the room's state, and
      // the room is held for its duration. Nothing can observe a half-settled
      // kill, and the killSeq it claims is a D1 idempotency key that survives
      // this DO being evicted mid-grant.
      if (out.kill) {
        this.killSeq += 1
        await this.settleKill(out.kill, this.killSeq, now)
        await this.checkpoint(now)
        return
      }

      const phaseChanged = String(next.phase || 'active') !== this.checkpointedPhase
      const every = String(next.phase || 'active') === 'lobby' ? LOBBY_CHECKPOINT_EVERY_TICKS : CHECKPOINT_EVERY_TICKS
      if (phaseChanged || (next.tick || 0) - this.lastCheckpointTick >= every) {
        await this.checkpoint(now)
      }
    } finally {
      // Every exit from the beat, including the kill path's early return: the
      // tick becomes visible only now that nothing more can be appended to it.
      if (this.state) this.publishedTick = this.state.tick || 0
      // …and only now may it be pushed, for exactly the same reason a poll may
      // not see it earlier: a client that has acknowledged a tick can never be
      // shown anything appended to it afterwards, and settlement appends to the
      // tick the kill went out on.
      this.broadcast()
    }
  }

  /**
   * A One Life run ends wherever the character dies. The room resolves its own
   * combat, so the idle game's death paths never see this one and nothing else
   * would ever revoke the flag — the same gap `WorldZone` closes for the open
   * world (server/oneLife.ts).
   *
   * The room holds no copy of the flag: sessions that predate this feature
   * carry no such field on their members, and a checkpointed copy would only
   * be a second place for it to go stale. The guarded UPDATE is the read as
   * well as the write, so one round trip answers "was this a One Life
   * character" — and a death is terminal for the member (nothing revives them
   * inside a session), so this stays one write per member per fight rather
   * than a D1 write on an ordinary tick. A write D1 could not answer is
   * retried on the next beat instead of losing the revert.
   */
  private async endOneLifeRuns(events: AnyState[], tick: number): Promise<void> {
    for (const ev of events) {
      if (ev?.type !== 'memberDeath') continue
      const characterId = Number(ev.characterId)
      if (Number.isFinite(characterId)) this.pendingOneLifeDeaths.add(characterId)
    }
    if (this.pendingOneLifeDeaths.size === 0) return
    for (const characterId of [...this.pendingOneLifeDeaths]) {
      const ended = await revokeOneLifeIfSet(this.env as never, characterId)
      if (ended === null) continue
      this.pendingOneLifeDeaths.delete(characterId)
      if (ended) this.events = pushEvents(this.events, [{ type: 'oneLifeEnded', characterId, tick }], tick)
    }
  }

  private async settleKill(kill: AnyState, seq: number, now: number): Promise<void> {
    try {
      const settlement = await settleCoopKill(
        this.env as never,
        {
          // boss_id is whatever the room is fighting RIGHT NOW; for a raid the
          // kill record names the raid, and settlement rolls that table.
          session: { id: this.sessionId, boss_id: this.state?.bossId || this.bossId, raid_id: this.raidId },
          state: this.state,
          kill,
          killSeq: seq,
        },
        now,
      ) as AnyState
      const shares = (settlement.settlements || []) as AnyState[]
      this.events = pushEvents(this.events, [{
        type: 'killSettled',
        tick: this.state!.tick || 0,
        // One event carries every winner's share: a client that is not on the
        // list has to be able to tell "I missed the cut" from "the poll dropped
        // my event", and per-winner events would toast a bystander eight times.
        settlements: shares.map((s: AnyState) => ({
          characterId: s.characterId,
          granted: s.granted || [],
          killCount: s.killCount ?? null,
          diverged: !!s.diverged,
          // A grant that threw must never reach the player as an empty drop
          // list — that reads as an unlucky kill and hides the outage.
          failed: !!s.failed,
        })),
        lootDamageRequired: kill.lootDamageRequired ?? null,
        // Legacy single-winner fields, for a client deployed ahead of this Worker.
        ownerCharacterId: settlement.ownerCharacterId ?? kill.ownerCharacterId ?? null,
        granted: settlement.granted || [],
        killCount: settlement.killCount ?? null,
        diverged: !!settlement.diverged,
        // Every share threw: the kill is an outage, not a dry roll.
        failed: shares.length > 0 && shares.every((s: AnyState) => !!s.failed),
      }, ...this.epicDropEvents(shares)], this.state!.tick || 0)
    } catch (err) {
      console.error('[PocketRPG][coop] kill settlement failed', {
        sessionId: this.sessionId, bossId: this.bossId, killSeq: seq, message: (err as Error)?.message || err,
      })
      // A kill the client is never told about is the worst failure mode there
      // is: the boss drops, nothing happens, and the player has no idea whether
      // they were robbed or simply unlucky. Say so instead of going silent.
      this.events = pushEvents(this.events, [{
        type: 'killSettled',
        tick: this.state?.tick || 0,
        settlements: (kill.lootCharacterIds || []).map((characterId: number) => ({
          characterId, granted: [], killCount: null, diverged: false, failed: true,
        })),
        lootDamageRequired: kill.lootDamageRequired ?? null,
        ownerCharacterId: kill.ownerCharacterId ?? null,
        granted: [],
        killCount: null,
        diverged: false,
        failed: true,
      }], this.state?.tick || 0)
    }
  }

  /**
   * The room-wide announcement of a purple drop. Deliberately NOT filtered by
   * projectEventsForMember the way a settlement's item list is: who won a
   * legendary and what it was is the one part of a kill everybody is meant to
   * see. It carries that item only — the rest of the winner's drops stay theirs.
   */
  private epicDropEvents(shares: AnyState[]): AnyState[] {
    return coopEpicDropEvents({
      shares,
      members: this.state?.members,
      bossName: (monstersData as AnyState)?.[this.bossId]?.name || 'the boss',
      tick: this.state?.tick || 0,
      itemsData,
    }) as AnyState[]
  }

  /**
   * Releases members whose client has gone quiet. The save lock follows the
   * member, so a player whose tab crashed has to be let go even though the room
   * fights on without them — the old session-wide timer left them locked out of
   * their own save for as long as anybody else kept playing.
   */
  private async ejectStaleMembers(now: number): Promise<void> {
    const stale = staleMemberIds(this.state, this.lastSeen, now, COOP_SESSION_STALE_MS)
    for (const id of stale) {
      const member = this.state?.members?.[id]
      if (!member) continue
      try {
        await writeBackMember(this.env as never, {
          characterId: member.characterId,
          identityId: member.ownerId,
          member,
          sessionId: this.sessionId,
        })
      } catch (err) {
        console.error('[PocketRPG][coop] eject write-back failed', {
          sessionId: this.sessionId, characterId: member.characterId, message: (err as Error)?.message || err,
        })
      }
      this.state = removeCoopMember(this.state, member.characterId)
      this.pending = this.pending.filter((i) => String(i.characterId) !== id)
      this.dropSockets(id, 'ejected')
      delete this.lastSeen[id]
      delete this.chatTimes[id]
      delete this.heartbeatWrittenAt[id]
      this.dirty = true
      this.events = pushEvents(this.events, [{
        type: 'memberLeft', tick: this.state?.tick || 0, characterId: member.characterId,
      }], this.state?.tick || 0)
    }
    if (stale.length > 0) await this.checkpoint(now)
  }

  private handlePoll(key: string, body: Record<string, any>): Response {
    this.lastSeen[key] = Date.now()
    this.startTicking()
    const since = Number(body?.sinceTick)
    const currentTick = this.publishedTick
    return jsonResponse({
      ok: true,
      state: projectStateForMember(this.state, key),
      // Replayed from the room's ring rather than "whatever happened on the one
      // request that advanced the tick", so every member sees every hit, every
      // XP drop and every kill — not just the ~1-in-8 they won the race for.
      events: projectEventsForMember(
        eventsSince(this.events, Number.isFinite(since) ? since : currentTick - 1, currentTick),
        key,
      ),
      current_tick: currentTick,
      next_tick_at: Date.now() + TICK_MS,
      // Relative, so it survives a client clock that is minutes off. A poll
      // aimed at this lands just after the beat rather than a round trip into
      // it, which is what keeps the fight arriving one tick at a time.
      next_tick_in_ms: Math.max(0, this.lastTickAt + TICK_MS - Date.now()),
    })
  }

  private handleIntent(key: string, body: Record<string, any>): Response {
    const result = this.queueIntent(key, body?.action)
    return result.error
      ? jsonResponse({ error: result.error }, result.status || 400)
      : jsonResponse({ ok: true, tick_number: result.tick_number })
  }

  /**
   * Accepts one action from a member, whichever transport carried it.
   *
   * Validation runs HERE rather than only at the Pages edge, because a socket
   * frame never passes through the edge: chat would reach the room unsanitised
   * and toggle_prayer would arrive without the slot resolved from the prayer's
   * own data. Re-validating an action the edge already normalised is a no-op.
   */
  private queueIntent(key: string, rawAction: unknown): { error?: string; status?: number; tick_number?: number } {
    const member = this.state!.members[key]
    this.lastSeen[key] = Date.now()
    const validated = validateCoopAction(rawAction) as { error?: string; action?: AnyState }
    if (validated.error) return { error: validated.error, status: 400 }
    const action = validated.action as AnyState
    // Chat is not a combat action: it takes no queue slot, and it works while
    // dead and through the respawn wait, which is when a group actually talks.
    if (action.type === 'chat') return this.queueChat(key, member, action.text)
    if (member.status !== 'alive') return { error: 'member_dead', status: 409 }
    const queued = this.pending.filter((i) => String(i.characterId) === key).length
    if (queued >= MAX_PENDING_INTENTS_PER_MEMBER) return { error: 'too_many_queued_actions', status: 429 }
    this.intentSeq += 1
    this.pending.push({
      tick_number: (this.state!.tick || 0) + 1,
      characterId: member.characterId,
      // A monotonic counter, not a wall-clock remainder: two actions in the
      // same millisecond used to collide and order arbitrarily.
      characterSeq: this.intentSeq,
      action,
    })
    return { tick_number: (this.state!.tick || 0) + 1 }
  }

  private queueChat(key: string, member: AnyState, raw: unknown): { error?: string; status?: number; tick_number?: number } {
    const text = sanitizeChat(typeof raw === 'string' ? raw : '')
    if (!text) return { error: 'invalid_chat', status: 400 }
    const verdict = chatRateVerdict(this.chatTimes[key], Date.now(), CHAT_RATE_WINDOW_MS, CHAT_RATE_MAX_IN_WINDOW)
    this.chatTimes[key] = verdict.times
    if (!verdict.allowed) return { error: 'chat_rate_limited', status: 429 }
    this.pendingChat.push({
      type: 'chatMessage', characterId: member.characterId, username: member.username, text,
    })
    // Player-authored text broadcast to strangers needs a durable history for
    // safety review. Swallowed: an audit outage must not silence the room, and
    // the failure is logged either way.
    void auditLog(this.env, 'coop_chat', {
      characterId: member.characterId,
      identityId: member.ownerId ?? null,
      sessionId: this.sessionId,
      bossId: this.bossId,
      text,
    }, { swallow: true })
    return {}
  }

  /**
   * Attaches a live push connection for one member.
   *
   * The fight was polled at ~1.7Hz per member, and every poll was a Pages
   * invocation, a JWT verification and a `SELECT` against `characters` just to
   * learn who was asking — 800-odd D1 reads a minute for a full room, to move a
   * state the room could simply have pushed. This is that push: the caller has
   * already been authenticated at the edge (a 60s socket ticket), so the room
   * only has to decide what to send and when.
   *
   * Joining is deliberately NOT part of connecting. A reconnect must attach to
   * the member who is already in the fight, never re-seed them — that would
   * re-arm their timers and throw away the damage their loot share is measured
   * from.
   */
  private handleSocket(key: string, request: Request, body: Record<string, any>): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return jsonResponse({ error: 'expected_websocket' }, 426)
    }
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    // Plain accept() rather than the hibernation API: a room with a live fight
    // holds its whole state in memory and beats on a 600ms interval, so it is
    // never idle enough to hibernate. Hibernating would mean rebuilding the
    // fight from a checkpoint up to 25 ticks old.
    server.accept()

    const since = Number(body?.sinceTick)
    const conn: Conn = {
      key,
      projection: null,
      ackTick: Number.isFinite(since) ? since : this.publishedTick,
      frameTimes: [],
    }
    this.conns.set(server, conn)
    this.lastSeen[key] = Date.now()
    this.startTicking()

    server.addEventListener('message', (event: MessageEvent) => {
      this.onSocketFrame(server, conn, event.data)
    })
    const drop = () => {
      if (!this.conns.delete(server)) return
      this.onConnClosed(conn)
    }
    server.addEventListener('close', drop)
    server.addEventListener('error', drop)

    // The full picture first, so every later frame can be a delta against it.
    // A reconnect gets the events it missed too, bounded by the room's ring.
    const projection = projectStateForMember(this.state, key) as AnyState
    conn.projection = projection
    const events = projectEventsForMember(eventsSince(this.events, conn.ackTick, this.publishedTick), key)
    conn.ackTick = this.publishedTick
    this.sendFrame(server, {
      t: COOP_FRAME_SYNC,
      tick: this.publishedTick,
      state: projection,
      events,
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  private onSocketFrame(ws: WebSocket, conn: Conn, data: unknown): void {
    const now = Date.now()
    conn.frameTimes = conn.frameTimes.filter((t) => now - t < SOCKET_FRAME_WINDOW_MS)
    conn.frameTimes.push(now)
    if (conn.frameTimes.length > SOCKET_FRAME_MAX_IN_WINDOW) {
      // Not a refusal the client can retry past — a game client cannot produce
      // this rate, so the socket is closed rather than throttled.
      this.sendFrame(ws, { t: COOP_FRAME_BYE, reason: 'flooding' })
      try { ws.close(1008, 'flooding') } catch { /* already gone */ }
      return
    }

    let frame: Record<string, any>
    try {
      frame = JSON.parse(typeof data === 'string' ? data : '') as Record<string, any>
    } catch {
      return
    }
    if (frame?.t === 'ping') {
      this.sendFrame(ws, { t: COOP_FRAME_PONG })
      this.lastSeen[conn.key] = now
      return
    }
    if (frame?.t !== 'intent') return
    // A member the room has already ejected must not be able to act; the socket
    // is closed rather than left half-alive.
    if (!this.state?.members?.[conn.key]) {
      this.sendFrame(ws, { t: COOP_FRAME_BYE, reason: 'not_a_member' })
      try { ws.close(1008, 'not_a_member') } catch { /* already gone */ }
      return
    }
    const result = this.queueIntent(conn.key, frame.action)
    this.sendFrame(ws, result.error
      // The status travels with the refusal because the client still reads it:
      // a rate-limited message is "slow down", not the raw error code the
      // player would otherwise be shown.
      ? { t: COOP_FRAME_NACK, id: frame.id ?? null, error: result.error, status: result.status || 400 }
      : { t: COOP_FRAME_ACK, id: frame.id ?? null, tick_number: result.tick_number })
  }

  /**
   * A socket went away. If it was this member's last one they are given a short
   * linger and then ejected by the ordinary staleness path — expressed by
   * back-dating their heartbeat rather than as a second timer, because the save
   * lock follows the member and one clock is easier to reason about than two.
   *
   * Back-dating also means any later proof of life undoes it for free: a client
   * whose socket failed and fell back to polling stamps `lastSeen = now` on its
   * next poll and is simply not stale any more.
   */
  private onConnClosed(conn: Conn): void {
    for (const other of this.conns.values()) if (other.key === conn.key) return
    const seen = this.lastSeen[conn.key] ?? 0
    const lingerUntilStale = Date.now() - (COOP_SESSION_STALE_MS - COOP_SOCKET_LINGER_MS)
    this.lastSeen[conn.key] = Math.min(seen, lingerUntilStale)
  }

  /** Closes every socket belonging to a member the room has finished with, so a
   * client is told rather than left watching a fight it is no longer in. */
  private dropSockets(key: string, reason: string): void {
    for (const [ws, conn] of this.conns) {
      if (conn.key !== key) continue
      this.conns.delete(ws)
      this.sendFrame(ws, { t: COOP_FRAME_BYE, reason })
      try { ws.close(1000, reason) } catch { /* already gone */ }
    }
  }

  private sendFrame(ws: WebSocket, frame: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify(frame))
    } catch {
      // A send to a socket the runtime has already torn down is not an error
      // worth failing a tick over; the close listener cleans it up.
    }
  }

  /**
   * Pushes the beat to every connected client.
   *
   * Only what moved: each socket carries the projection it was last sent, so a
   * steady tick costs the boss's HP, the mover's combat state and the events —
   * not the pack, gear, levels and quest list that dominate a member record and
   * change a few times an hour. A beat where nothing but the tick counter moved
   * and no event fired is not sent at all, which is what makes a raid lobby
   * cost nothing to sit in.
   */
  private broadcast(): void {
    if (this.conns.size === 0) return
    const tick = this.publishedTick
    const now = Date.now()
    for (const [ws, conn] of this.conns) {
      const member = this.state?.members?.[conn.key]
      if (!member) {
        this.conns.delete(ws)
        this.sendFrame(ws, { t: COOP_FRAME_BYE, reason: 'not_a_member' })
        try { ws.close(1000, 'not_a_member') } catch { /* already gone */ }
        continue
      }
      // An open socket is proof of presence, so a connected member never
      // reaches the poll-staleness path.
      this.lastSeen[conn.key] = now
      const projection = projectStateForMember(this.state, conn.key) as AnyState
      const events = projectEventsForMember(eventsSince(this.events, conn.ackTick, tick), conn.key)
      const delta = projectionDelta(conn.projection, projection)
      if (!deltaWorthSending(delta, events.length)) continue
      conn.projection = projection
      conn.ackTick = tick
      this.sendFrame(ws, {
        t: COOP_FRAME_TICK,
        tick,
        delta,
        ...(events.length > 0 ? { events } : {}),
      })
    }
  }

  private handleDepart(key: string): Promise<Response> {
    // Same queue as the tick: the write-back and the state swap below must not
    // land in the middle of a beat that is awaiting D1.
    return this.runExclusive(async () => {
      if (this.state?.members?.[key]) {
        this.lastSeen[key] = 0
        await this.ejectStaleMembers(Date.now())
        if (this.state && memberCount(this.state) === 0) await this.closeRoom(Date.now())
      }
      return jsonResponse({ ok: true })
    })
  }

  /** Mirrors the live fight back to D1 so the crash sweep has something recent
   * to write members back from, and so the boss picker's HP columns stay fresh. */
  private async checkpoint(now: number): Promise<void> {
    if (!this.state || !this.dirty) return
    this.dirty = false
    this.lastCheckpointTick = this.state.tick || 0
    this.checkpointedPhase = String(this.state.phase || 'active')
    // boss_id, phase and host_character_id are mirrored so the lobby list can be
    // rendered from the row alone — a party browser must not have to wake every
    // room to find out whether it has set off yet.
    const statements = [
      this.env.DB.prepare(
        `UPDATE coop_boss_sessions
            SET state_json = ?, current_tick = ?, last_tick_at = ?, member_count = ?,
                boss_hp = ?, boss_max_hp = ?, kill_seq = ?, boss_id = ?, phase = ?, host_character_id = ?
          WHERE id = ?`,
      ).bind(
        JSON.stringify(this.state), this.state.tick || 0, now, memberCount(this.state),
        this.state.boss?.currentHP ?? null, this.state.boss?.maxHP ?? null, this.killSeq,
        this.state.bossId || this.bossId, this.state.phase || 'active',
        this.state.hostCharacterId ?? null, this.sessionId,
      ),
    ]
    // /api/save reads coop_session_members.last_seen_at to decide whether this
    // character's save is locked, so each member's OWN last proof of life has to
    // reach the row — stamping `now` across the board would keep a crashed
    // member's heartbeat fresh and lock them out of their save until the room
    // emptied, which is the whole bug the per-member clock exists to fix.
    //
    // Refreshed on its own 30s clock rather than on every checkpoint: the row
    // only has to stay inside COOP_SESSION_STALE_MS (90s), so writing it four
    // times a minute per member bought nothing. A heartbeat that moved BACKWARDS
    // is written immediately — that is a socket closing, and the sooner the row
    // says so the sooner the player has their save back.
    for (const id of Object.keys(this.state.members || {})) {
      const seen = this.lastSeen[id] || 0
      if (seen <= 0) continue
      const written = this.heartbeatWrittenAt[id] || 0
      if (seen >= written && now - written < HEARTBEAT_WRITE_EVERY_MS) continue
      this.heartbeatWrittenAt[id] = now
      statements.push(this.env.DB.prepare(
        'UPDATE coop_session_members SET last_seen_at = ? WHERE session_id = ? AND character_id = ? AND left_at IS NULL',
      ).bind(seen, this.sessionId, Number(id)))
    }
    // One batch, one round trip: the state row and the heartbeats used to be two
    // awaits inside a beat that is already holding the room.
    await this.env.DB.batch(statements)
  }

  private async closeRoom(now: number): Promise<void> {
    this.stopTicking()
    for (const key of new Set([...this.conns.values()].map((c) => c.key))) {
      this.dropSockets(key, 'session_ended')
    }
    if (!this.sessionId) return
    await this.env.DB.prepare(
      `UPDATE coop_boss_sessions SET status = 'completed', ended_at = ?, member_count = 0, last_tick_at = ?
        WHERE id = ? AND status = 'active'`,
    ).bind(now, now, this.sessionId).run()
    this.state = null
    this.sessionId = 0
    this.events = []
    this.pending = []
    this.pendingChat = []
    this.chatTimes = {}
    this.heartbeatWrittenAt = {}
  }
}
