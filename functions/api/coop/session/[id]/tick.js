import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../../_lib/pvp.js'
import { processCoopTick } from '../../../../../src/engine/coopBossEngine.js'
import {
  COOP_ENGINE_DEPS,
  parseSessionState,
  readSession,
  settleCoopKill,
} from '../../../../_lib/game/coopBoss.js'

const COOP_TICK_MS = 600
const COOP_TICK_GRACE_MS = 75

export function shouldAdvanceCoopTick(now, lastTickAt) {
  const safeNow = Number(now) || 0
  const safeLast = Number(lastTickAt) || 0
  if (safeLast <= 0) return { advance: true, nextTickAt: safeNow + COOP_TICK_MS }
  const nextTickAt = safeLast + COOP_TICK_MS
  return { advance: safeNow + COOP_TICK_GRACE_MS >= nextTickAt, nextTickAt }
}

function appliedIntentsStatement(env, intentIds) {
  if (!intentIds.length) return null
  const ids = intentIds.map(() => '?').join(',')
  return env.DB.prepare(`UPDATE coop_intents SET applied = 1 WHERE id IN (${ids})`).bind(...intentIds)
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const sessionId = parseInt(params.id, 10)
  if (!Number.isFinite(sessionId)) return json({ error: 'Invalid session id' }, 400)

  const row = await readSession(env, sessionId)
  if (!row) return json({ error: 'coop_session_not_found' }, 404)
  if (row.status !== 'active') return json({ error: 'coop_session_not_active' }, 409)

  const state = parseSessionState(row)
  if (!state) return json({ error: 'invalid_session_state' }, 500)
  if (!state.members?.[String(ch.id)]) return json({ error: 'not_a_member' }, 403)

  const now = Date.now()
  const pacing = shouldAdvanceCoopTick(now, row.last_tick_at)
  // Every member polls, so all but the first caller in a 600ms window get the
  // current state back rather than advancing it again. Unlike PvP the state is
  // always returned: a non-advancing member still has to render the fight.
  if (!pacing.advance) {
    return json({
      ok: true,
      advanced: false,
      state,
      events: [],
      current_tick: row.current_tick,
      next_tick_at: pacing.nextTickAt,
    })
  }

  const intentRows = await env.DB.prepare(
    `SELECT id, character_id, tick_number, character_seq, action_json
       FROM coop_intents
      WHERE session_id = ? AND applied = 0 AND tick_number <= ?
      ORDER BY tick_number ASC, character_id ASC, character_seq ASC`,
  ).bind(sessionId, (state.tick || 0) + 1).all()

  const intents = []
  const appliedIntentIds = []
  for (const intentRow of intentRows.results || []) {
    appliedIntentIds.push(intentRow.id)
    try {
      intents.push({
        tick_number: intentRow.tick_number,
        characterId: intentRow.character_id,
        characterSeq: intentRow.character_seq,
        action: JSON.parse(intentRow.action_json),
      })
    } catch {
      // A malformed row is still marked applied so it cannot wedge the fight.
    }
  }

  const out = processCoopTick(state, intents, COOP_ENGINE_DEPS, now)

  // Loot settles BEFORE the state write: settleCoopKill folds the winner's
  // drops back into their session inventory, and that updated state is what we
  // persist below.
  let settlement = null
  if (out.kill) {
    try {
      settlement = await settleCoopKill(env, { session: row, state: out.stateNext, kill: out.kill }, now)
    } catch (err) {
      console.error('[PocketRPG][coop] kill settlement failed', { sessionId, bossId: row.boss_id, message: err?.message || err })
    }
  }

  const writes = [
    env.DB.prepare(
      `UPDATE coop_boss_sessions SET state_json = ?, current_tick = ?, last_tick_at = ?
        WHERE id = ? AND status = 'active' AND current_tick = ?`,
    ).bind(JSON.stringify(out.stateNext), out.stateNext.tick || 0, now, sessionId, row.current_tick),
  ]
  const markIntents = appliedIntentsStatement(env, appliedIntentIds)
  if (markIntents) writes.push(markIntents)
  const [updateRes] = await env.DB.batch(writes)

  if (updateRes.meta.changes === 0) {
    // Another member advanced this tick first; hand back what they wrote.
    const current = await readSession(env, sessionId)
    return json({
      ok: true,
      advanced: false,
      state: current ? parseSessionState(current) : null,
      events: [],
      current_tick: current?.current_tick ?? row.current_tick,
      next_tick_at: (Number(current?.last_tick_at) || now) + COOP_TICK_MS,
    })
  }

  return json({
    ok: true,
    advanced: true,
    state: out.stateNext,
    events: out.events,
    current_tick: out.stateNext.tick || 0,
    kill: out.kill ? { ...out.kill, settlement } : null,
  })
}
