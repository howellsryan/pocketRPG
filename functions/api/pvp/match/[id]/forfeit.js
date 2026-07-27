import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../../_lib/pvp.js'
import { callPvpRoom, pvpRoomResponse } from '../../../../_lib/game/pvpRoom.js'

// Forfeit is an ordinary action: the room applies it on the next beat and the
// engine resolves it as a death, so the loot transfer path is the normal one.
export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const matchId = parseInt(params.id, 10)
  if (!Number.isFinite(matchId)) return json({ error: 'Invalid match id' }, 400)

  return pvpRoomResponse(await callPvpRoom(env, matchId, 'intent', {
    characterId: ch.id,
    actions: [{ type: 'forfeit' }],
  }))
}
