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
import type { Env } from './env'

const TICK_MS = 600
/** How often the live fight is mirrored back to D1. The room is the authority
 * while it lives; the checkpoint exists so the crash sweep has something recent
 * to write members back from. */
const CHECKPOINT_EVERY_TICKS = 25
/** A member may have this many actions waiting for the next beat. The room is
 * single-threaded so there is no table to contend on any more — this only stops
 * a client spending the room's memory. */
const MAX_PENDING_INTENTS_PER_MEMBER = 4

type AnyState = Record<string, any>
type QueuedIntent = { tick_number: number; characterId: number; characterSeq: number; action: unknown }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export class CoopBossRoom {
  private state: AnyState | null = null
  private sessionId = 0
  private bossId = ''
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
  private intentSeq = 0
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private loading: Promise<void> | null = null
  private dirty = false
  private lastCheckpointTick = 0
  private busy = false
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
    const action = new URL(request.url).pathname.split('/').filter(Boolean).pop()
    const body = await request.json().catch(() => ({})) as Record<string, any>
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
      this.lastCheckpointTick = Number(this.state?.tick) || 0
      this.publishedTick = Number(this.state?.tick) || 0

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
      this.events = pushEvents(this.events, out.events, next.tick)
      this.dirty = true

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

      if ((next.tick || 0) - this.lastCheckpointTick >= CHECKPOINT_EVERY_TICKS) await this.checkpoint(now)
    } finally {
      // Every exit from the beat, including the kill path's early return: the
      // tick becomes visible only now that nothing more can be appended to it.
      if (this.state) this.publishedTick = this.state.tick || 0
    }
  }

  private async settleKill(kill: AnyState, seq: number, now: number): Promise<void> {
    try {
      const settlement = await settleCoopKill(
        this.env as never,
        { session: { id: this.sessionId, boss_id: this.bossId }, state: this.state, kill, killSeq: seq },
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
      }], this.state!.tick || 0)
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
      delete this.lastSeen[id]
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
    })
  }

  private handleIntent(key: string, body: Record<string, any>): Response {
    const member = this.state!.members[key]
    this.lastSeen[key] = Date.now()
    if (member.status !== 'alive') return jsonResponse({ error: 'member_dead' }, 409)
    const queued = this.pending.filter((i) => String(i.characterId) === key).length
    if (queued >= MAX_PENDING_INTENTS_PER_MEMBER) return jsonResponse({ error: 'too_many_queued_actions' }, 429)
    this.intentSeq += 1
    this.pending.push({
      tick_number: (this.state!.tick || 0) + 1,
      characterId: member.characterId,
      // A monotonic counter, not a wall-clock remainder: two actions in the
      // same millisecond used to collide and order arbitrarily.
      characterSeq: this.intentSeq,
      action: body?.action,
    })
    return jsonResponse({ ok: true, tick_number: (this.state!.tick || 0) + 1 })
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
    await this.env.DB.prepare(
      `UPDATE coop_boss_sessions
          SET state_json = ?, current_tick = ?, last_tick_at = ?, member_count = ?,
              boss_hp = ?, boss_max_hp = ?, kill_seq = ?
        WHERE id = ?`,
    ).bind(
      JSON.stringify(this.state), this.state.tick || 0, now, memberCount(this.state),
      this.state.boss?.currentHP ?? null, this.state.boss?.maxHP ?? null, this.killSeq, this.sessionId,
    ).run()
    // /api/save reads coop_session_members.last_seen_at to decide whether this
    // character's save is locked, so each member's OWN last poll has to reach
    // the row — stamping `now` across the board would keep a crashed member's
    // heartbeat fresh and lock them out of their save until the room emptied,
    // which is the whole bug the per-member clock exists to fix.
    const heartbeats = Object.keys(this.state.members || {})
      .map((id) => [Number(id), this.lastSeen[id] || 0] as const)
      .filter(([, seen]) => seen > 0)
    if (heartbeats.length > 0) {
      await this.env.DB.batch(heartbeats.map(([characterId, seen]) =>
        this.env.DB.prepare(
          'UPDATE coop_session_members SET last_seen_at = ? WHERE session_id = ? AND character_id = ? AND left_at IS NULL',
        ).bind(seen, this.sessionId, characterId)))
    }
  }

  private async closeRoom(now: number): Promise<void> {
    this.stopTicking()
    if (!this.sessionId) return
    await this.env.DB.prepare(
      `UPDATE coop_boss_sessions SET status = 'completed', ended_at = ?, member_count = 0, last_tick_at = ?
        WHERE id = ? AND status = 'active'`,
    ).bind(now, now, this.sessionId).run()
    this.state = null
    this.sessionId = 0
    this.events = []
    this.pending = []
  }
}
