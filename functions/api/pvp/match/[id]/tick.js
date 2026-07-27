import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../../_lib/pvp.js'
import { callPvpRoom, pvpRoomResponse } from '../../../../_lib/game/pvpRoom.js'

/**
 * Poll one beat of a duel.
 *
 * The fight is advanced by the room's own 600ms clock (PvpMatchRoom), not by
 * this request — this only proves who is asking, refreshes their heartbeat, and
 * returns the state plus everything that happened since the tick they last
 * acknowledged. That last part is what stopped a duellist seeing only the beats
 * they happened to win the old optimistic race for.
 *
 * No stale-row sweep here: it ran seven statements per request on the hottest
 * path in the game, and the lobby, waiting room, invitation and save endpoints
 * already run it on natural traffic.
 */
export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const matchId = parseInt(params.id, 10)
  if (!Number.isFinite(matchId)) return json({ error: 'Invalid match id' }, 400)

  const body = await request.json().catch(() => ({}))
  const sinceTick = Number.isFinite(Number(body?.sinceTick)) ? Number(body.sinceTick) : null

  return pvpRoomResponse(await callPvpRoom(env, matchId, 'poll', {
    characterId: ch.id,
    ...(sinceTick === null ? {} : { sinceTick }),
  }))
}
