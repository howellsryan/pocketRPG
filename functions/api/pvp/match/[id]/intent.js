import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../../_lib/pvp.js'
import { callPvpRoom, pvpRoomResponse } from '../../../../_lib/game/pvpRoom.js'

/**
 * Queue one or more actions for the next beat.
 *
 * `actions` is an array so a full armour swap is one request: the client used
 * to POST one intent per gear piece and then a tick, and each of those wrote a
 * durable row. The room validates against its own live state — that is why
 * validateIntentAction lives in functions/_lib/pvpIntent.js and not here.
 */
export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const matchId = parseInt(params.id, 10)
  if (!Number.isFinite(matchId)) return json({ error: 'Invalid match id' }, 400)

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const actions = Array.isArray(body?.actions) ? body.actions : (body?.action ? [body.action] : [])
  if (actions.length === 0) return json({ error: 'invalid_action' }, 400)

  return pvpRoomResponse(await callPvpRoom(env, matchId, 'intent', { characterId: ch.id, actions }))
}
