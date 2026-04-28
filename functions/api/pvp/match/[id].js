import { requireAuth, json } from '../../../_lib/auth.js'
import { getOwnedCharacter, sweepStaleRows } from '../../../_lib/pvp.js'
import { readOwnedActiveMatch } from '../../../_lib/pvpMatch.js'

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const matchId = parseInt(params.id, 10)
  if (!Number.isFinite(matchId)) return json({ error: 'Invalid match id' }, 400)

  await sweepStaleRows(env)

  const found = await readOwnedActiveMatch(env, matchId, ch.id)
  if (found.error) return json({ error: found.error }, found.status)

  const match = found.row
  let state = null
  try {
    state = JSON.parse(match.state_json)
  } catch {
    return json({ error: 'invalid_match_state' }, 500)
  }

  const sinceTickRaw = new URL(request.url).searchParams.get('since_tick')
  const sinceTick = sinceTickRaw == null ? null : parseInt(sinceTickRaw, 10)
  const hasDelta = Number.isFinite(sinceTick)
  const changed = !hasDelta || (state.tick || 0) > sinceTick

  return json({
    match: {
      id: match.id,
      status: match.status,
      character_a: match.character_a,
      character_b: match.character_b,
      current_tick: match.current_tick,
      last_tick_at: match.last_tick_at,
    },
    state: changed ? state : null,
    state_changed: changed,
  })
}
