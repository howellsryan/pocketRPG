import { requireAuth, json } from '../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../_lib/pvp.js'
import { readOwnedActiveMatch } from '../../../_lib/pvpMatch.js'
import { callPvpRoom } from '../../../_lib/game/pvpRoom.js'
import { readPvpEndSummary } from '../../../../src/engine/pvpEndSummary.js'

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const matchId = parseInt(params.id, 10)
  if (!Number.isFinite(matchId)) return json({ error: 'Invalid match id' }, 400)

  const found = await readOwnedActiveMatch(env, matchId, ch.id)
  if (found.error) return json({ error: found.error }, found.status)

  const match = found.row
  let state = null
  try {
    state = JSON.parse(match.state_json)
  } catch {
    return json({ error: 'invalid_match_state' }, 500)
  }

  // The row's state_json is written at creation and then only at settlement, so
  // for a live duel it is the opening snapshot — the room holds the real one.
  // A completed match is the opposite: the row carries the final state and the
  // end summary the client recovers from, and the room may be long gone.
  let currentTick = match.current_tick
  if (match.status === 'active') {
    const room = await callPvpRoom(env, matchId, 'poll', { characterId: ch.id })
    if (room.status === 200 && room.body?.state) {
      state = room.body.state
      currentTick = room.body.current_tick ?? currentTick
    }
  }

  const endSummary = readPvpEndSummary(state, match)

  const sinceTickRaw = new URL(request.url).searchParams.get('since_tick')
  const sinceTick = sinceTickRaw == null ? null : parseInt(sinceTickRaw, 10)
  const hasDelta = Number.isFinite(sinceTick)
  const changed = !hasDelta || (state.tick || 0) > sinceTick || match.status !== 'active' || !!endSummary

  return json({
    match: {
      id: match.id,
      status: match.status,
      character_a: match.character_a,
      character_b: match.character_b,
      current_tick: currentTick,
      last_tick_at: match.last_tick_at,
      winner_character_id: match.winner_character_id || null,
      ended_at: match.ended_at || null,
    },
    state: changed ? state : null,
    state_changed: changed,
    terminal: endSummary?.terminal || null,
    terminal_writeback: endSummary ? endSummary.writebackOk !== false : null,
    end_summary: endSummary || null,
    loot: endSummary?.loot || null,
    ended_at: endSummary?.endedAt || match.ended_at || null,
  })
}
