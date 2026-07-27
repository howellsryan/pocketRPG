// One PvP duel, as a Durable Object.
//
// The match used to run over D1: both duellists polled
// POST /api/pvp/match/:id/tick every 600ms, whichever request arrived first
// inside the window advanced the fight under an optimistic
// `WHERE current_tick = ?` guard, and the loser threw its work away and
// answered `state: null`. Three problems came out of that.
//
//   Delivery. A client only ever saw the beats it won the race for — roughly
//   every other one — because the losing response carried no state and no
//   events. Co-op had the same bug at 1-in-8 and fixed it with an event ring.
//
//   Pacing. The fight advanced only as fast as somebody polled. Two
//   backgrounded tabs (1500ms each) ran the duel in slow motion and then
//   tripped the 15s stall sweep, which aborts a match and transfers no loot.
//
//   Cost. Every poll re-read and rewrote a state blob holding both combatants'
//   full inventories, and every action was a durable pvp_intents row, on top of
//   a full stale-row sweep per request.
//
// The room fixes all three by construction: one object per match, one thread,
// state in memory, and the duel advanced by the room's own clock. D1 sees a
// heartbeat every ~10s and the settlement — nothing else.

import { processPvpTick, applyPvpSpecialAttackRegenToState } from '../../src/engine/pvpEngine.js'
import { computeBotIntents } from '../../src/engine/pvpBotAI.js'
import { validateIntentAction } from '../../functions/_lib/pvpIntent.js'
import { settlePvpMatch, abortPvpMatch } from '../../functions/_lib/pvpSettle.js'
import { itemsData } from '../../functions/_lib/pvpMatch.js'
import { eventsSince, pushEvents } from '../../functions/_lib/game/roomEvents.js'
import type { Env } from './env'

const TICK_MS = 600
/**
 * How often the row's last_tick_at is refreshed. The global stall sweep
 * (functions/_lib/pvp.js) aborts any active match that has not moved in
 * PVP_MATCH_STALL_MS, and it can no longer see the room's clock — so this
 * heartbeat is what tells it the duel is alive. Keep it comfortably under
 * that cutoff.
 */
const HEARTBEAT_EVERY_TICKS = 16
/** A duellist whose client has been silent this long is treated as gone. The
 * room fights on while at least one of them is still polling — a closed tab
 * must still lose the duel — and gives up when both are quiet. */
const CLIENT_IDLE_MS = 15_000
/** Actions a client may have waiting for the next beat. */
const MAX_PENDING_INTENTS_PER_CHARACTER = 8

type AnyState = Record<string, any>
type QueuedIntent = { tick_number: number; characterId: number; characterSeq: number; action: unknown }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export class PvpMatchRoom {
  private state: AnyState | null = null
  private match: AnyState | null = null
  private matchId = 0
  /** The last tick the room will admit to. A tick becomes visible only once
   * nothing more can be appended to it — settlement included — because a client
   * that acknowledges a tick can never be shown anything added to it
   * afterwards. */
  private publishedTick = 0
  private events: AnyState[] = []
  private lastSeen: Record<string, number> = {}
  private pending: QueuedIntent[] = []
  private intentSeq = 0
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private loading: Promise<void> | null = null
  private lastHeartbeatTick = 0
  private busy = false
  private queue: Promise<unknown> = Promise.resolve()
  /** The settled result, held so BOTH duellists collect it — the loser of the
   * final tick has to be told they died just as much as the winner does. */
  private outcome: AnyState | null = null
  private ctx: DurableObjectState
  private env: Env

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
  }

  /** Serialises everything that replaces this.state, so a settlement's D1
   * round-trips cannot interleave with a beat that is mutating combatants. */
  private runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.catch(() => {})
    return next
  }

  async fetch(request: Request): Promise<Response> {
    const action = new URL(request.url).pathname.split('/').filter(Boolean).pop()
    const body = await request.json().catch(() => ({})) as Record<string, any>
    const matchId = Number(body?.matchId)
    const characterId = Number(body?.characterId)
    if (!Number.isInteger(matchId) || matchId <= 0) return jsonResponse({ error: 'invalid_match' }, 400)
    if (!Number.isInteger(characterId) || characterId <= 0) return jsonResponse({ error: 'invalid_character' }, 400)

    await this.ensureLoaded(matchId)
    if (!this.state || !this.match) return jsonResponse({ error: 'match_not_active' }, 409)
    if (!this.state.combatants?.[String(characterId)]) return jsonResponse({ error: 'match_not_found' }, 404)

    switch (action) {
      case 'poll': return this.handlePoll(String(characterId), body)
      case 'intent': return this.handleIntent(String(characterId), body)
      case 'depart': return this.handleDepart(String(characterId))
      default: return jsonResponse({ error: 'unknown_action' }, 404)
    }
  }

  /**
   * Hydrates from DO storage first and D1 only as a fallback.
   *
   * Storage is checkpointed every tick, so an evicted room resumes essentially
   * where it left off. The row's state_json is written at match creation and
   * then only at settlement, so falling back to it mid-match would rewind the
   * duel to tick 0 — resurrecting a dead duellist and refunding eaten food.
   */
  private async ensureLoaded(matchId: number): Promise<void> {
    if (this.state && this.matchId === matchId) return
    if (this.loading) return this.loading
    this.loading = (async () => {
      const row = await this.env.DB.prepare(
        `SELECT id, character_a, character_b, status, current_tick, state_json, last_tick_at
           FROM pvp_matches WHERE id = ?`,
      ).bind(matchId).first<AnyState>()
      if (!row || row.status !== 'active') {
        this.state = null
        this.match = null
        return
      }

      const stored = await this.ctx.storage.get<AnyState>(`match:${matchId}`)
      let state: AnyState | null = stored?.state ?? null
      if (!state) {
        try { state = JSON.parse(row.state_json as string) } catch { state = null }
      }
      if (!state) {
        this.state = null
        this.match = null
        return
      }

      this.state = state
      this.match = row
      this.matchId = matchId
      this.events = Array.isArray(stored?.events) ? stored!.events : []
      this.publishedTick = Number(state.tick) || 0
      this.lastHeartbeatTick = Number(state.tick) || 0
      // Seed both clocks from now: a room reloading has no idea when either
      // client last spoke, and starting them at 0 would abort the duel on the
      // first beat.
      const now = Date.now()
      for (const id of Object.keys(state.combatants || {})) this.lastSeen[id] = now
      this.startTicking()
    })()
    try { await this.loading } finally { this.loading = null }
  }

  private startTicking(): void {
    if (this.tickTimer || this.outcome) return
    this.tickTimer = setInterval(() => { void this.tick() }, TICK_MS)
  }

  private stopTicking(): void {
    if (!this.tickTimer) return
    clearInterval(this.tickTimer)
    this.tickTimer = null
  }

  private async tick(): Promise<void> {
    if (!this.state || this.busy || this.outcome) return
    this.busy = true
    return this.runExclusive(() => this.tickInner()).finally(() => { this.busy = false })
  }

  private async tickInner(): Promise<void> {
    try {
      const now = Date.now()
      if (!this.state || !this.match) return

      // Both clients gone: end the duel the way the old stall sweep did —
      // aborted, no loot moved, because the engine never resolved a winner.
      if (this.everyClientIdle(now)) {
        await abortPvpMatch(this.env as never, this.match, this.state)
        await this.closeRoom()
        return
      }

      const intents = this.pending
      this.pending = []
      for (const botIntent of this.botIntents()) intents.push(botIntent)

      const out = processPvpTick(this.state, intents, itemsData, now)
      this.state = out.stateNext as AnyState
      this.events = pushEvents(this.events, out.events, this.state.tick)

      if (out.terminal) {
        await this.settle(out.terminal, now)
        return
      }

      await this.checkpoint()
      if ((this.state.tick || 0) - this.lastHeartbeatTick >= HEARTBEAT_EVERY_TICKS) await this.heartbeat(now)
    } finally {
      if (this.state) this.publishedTick = this.state.tick || 0
    }
  }

  /** Bot actions are computed fresh each beat and never persisted — the state
   * snapshot is the authority, so there is nothing to write down. */
  private botIntents(): QueuedIntent[] {
    const out: QueuedIntent[] = []
    const state = this.state
    if (!state) return out
    for (const [id, combatant] of Object.entries(state.combatants || {})) {
      if (!(combatant as AnyState)?.isBot) continue
      const botId = Number(id)
      // High seq so the bot acts after any human action queued for the same beat.
      let seq = 1000
      for (const action of computeBotIntents(state, botId, itemsData)) {
        out.push({ tick_number: (state.tick || 0) + 1, characterId: botId, characterSeq: seq++, action })
      }
    }
    return out
  }

  private everyClientIdle(now: number): boolean {
    const humanIds = Object.entries(this.state?.combatants || {})
      .filter(([, c]) => !(c as AnyState)?.isBot)
      .map(([id]) => id)
    if (humanIds.length === 0) return true
    return humanIds.every((id) => now - (this.lastSeen[id] || 0) >= CLIENT_IDLE_MS)
  }

  private async settle(terminal: AnyState, now: number): Promise<void> {
    let settled: AnyState
    try {
      settled = await settlePvpMatch(this.env as never, this.match, this.state, terminal) as AnyState
    } catch (err) {
      console.error('[PocketRPG][PvP] settlement threw', {
        matchId: this.matchId, message: (err as Error)?.message || err,
      })
      settled = { ok: false, reason: 'settlement_failed' }
    }
    if (!settled.ok) {
      console.error('[PocketRPG][PvP] terminal writeback failed', {
        matchId: this.matchId, winnerId: terminal.winner, loserId: terminal.loser, reason: settled.reason,
      })
    }
    // Held rather than pushed: both duellists have to be able to collect this,
    // and the loser's poll may not land until several beats later.
    this.outcome = {
      terminal: settled.endSummary?.terminal || terminal,
      terminal_writeback: !!settled.ok,
      end_summary: settled.endSummary || null,
      state: settled.state || this.state,
      loot: settled.loot?.summary || null,
      bot_loot_box: settled.botLootBox || null,
      collection_log_entries: settled.collectionLogEntries || [],
      ended_at: settled.endSummary?.endedAt || now,
    }
    if (settled.state) this.state = settled.state as AnyState
    this.stopTicking()
    // The match row now carries the final state and the end summary, so the
    // checkpoint has nothing left to protect and an evicted room would never
    // come back to clear it.
    await this.ctx.storage.delete(`match:${this.matchId}`)
  }

  private handlePoll(key: string, body: Record<string, any>): Response {
    this.lastSeen[key] = Date.now()
    this.startTicking()
    const since = Number(body?.sinceTick)
    const currentTick = this.publishedTick
    return jsonResponse({
      ok: true,
      state: this.state,
      // Replayed from the room's ring rather than "whatever happened on the
      // request that advanced the match", so both duellists see every swing.
      events: eventsSince(this.events, Number.isFinite(since) ? since : currentTick - 1, currentTick),
      current_tick: currentTick,
      next_tick_at: Date.now() + TICK_MS,
      ...(this.outcome || {}),
    })
  }

  /**
   * Queues this client's actions for the next beat.
   *
   * Takes an array because the client used to POST one intent per gear piece
   * and then a tick — a full armour swap was N+1 round-trips, each one a
   * durable row write. Order within the array is preserved, so a set of swaps
   * still applies in the order the player tapped them.
   */
  private handleIntent(key: string, body: Record<string, any>): Response {
    if (this.outcome) return jsonResponse({ error: 'match_not_active' }, 409)
    const combatant = this.state!.combatants[key]
    this.lastSeen[key] = Date.now()
    const actions = Array.isArray(body?.actions) ? body.actions : (body?.action ? [body.action] : [])
    if (actions.length === 0) return jsonResponse({ error: 'invalid_action' }, 400)

    const queued = this.pending.filter((i) => String(i.characterId) === key).length
    if (queued + actions.length > MAX_PENDING_INTENTS_PER_CHARACTER) {
      return jsonResponse({ error: 'too_many_queued_actions' }, 429)
    }

    // Special energy regenerates on the clock, so validate against a state
    // aged to now — otherwise a spec that came back between beats is refused.
    const fresh = applyPvpSpecialAttackRegenToState(this.state, Date.now()).state
    const rejected: AnyState[] = []
    const tickNumber = (this.state!.tick || 0) + 1
    for (let i = 0; i < actions.length; i++) {
      const checked = validateIntentAction(fresh, combatant.characterId, actions[i])
      if (!checked.ok) {
        rejected.push({ index: i, error: checked.error })
        continue
      }
      this.intentSeq += 1
      this.pending.push({
        tick_number: tickNumber,
        characterId: combatant.characterId,
        characterSeq: this.intentSeq,
        action: actions[i],
      })
    }
    return jsonResponse({ ok: true, tick_number: tickNumber, rejected })
  }

  private handleDepart(key: string): Response {
    // Not a forfeit: leaving the screen does not concede the duel. The room
    // keeps swinging while the opponent is still here, and gives up on its own
    // once nobody is left.
    this.lastSeen[key] = 0
    return jsonResponse({ ok: true })
  }

  /** Per-tick, into the room's own storage rather than D1. A duel has no
   * cross-request reader of its live state, so the only thing a checkpoint
   * protects against is eviction — and a coarse one would rewind the fight. */
  private async checkpoint(): Promise<void> {
    if (!this.state) return
    await this.ctx.storage.put(`match:${this.matchId}`, { state: this.state, events: this.events })
  }

  /** Tells the stall sweep the duel is alive. Deliberately does not carry the
   * state blob — that is what made the old model expensive. */
  private async heartbeat(now: number): Promise<void> {
    this.lastHeartbeatTick = this.state?.tick || 0
    await this.env.DB.prepare(
      "UPDATE pvp_matches SET last_tick_at = ?, current_tick = ? WHERE id = ? AND status = 'active'",
    ).bind(now, this.state?.tick || 0, this.matchId).run()
  }

  private async closeRoom(): Promise<void> {
    this.stopTicking()
    await this.ctx.storage.delete(`match:${this.matchId}`)
    this.state = null
    this.match = null
    this.events = []
    this.pending = []
    this.matchId = 0
  }
}
