import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../../_lib/pvp.js'
import { callCoopRoom } from '../../../../_lib/game/coopRoom.js'
import { parseCoopSessionId } from '../../../../_lib/game/coopBoss.js'
import { toErrorResponse } from '../../../../_lib/game/errors.js'

/**
 * Poll one beat of a co-op fight.
 *
 * The fight is advanced by the room's own 600ms clock (CoopBossRoom), not by
 * this request — this only proves who is asking, refreshes their heartbeat, and
 * returns the state plus everything that happened since the tick they last
 * acknowledged. That last part is what stopped members seeing only the ~1-in-8
 * ticks they happened to win the old race for.
 */
export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const sessionId = parseCoopSessionId(params.id)
  if (sessionId === null) return json({ error: 'Invalid session id' }, 400)

  const body = await request.json().catch(() => ({}))
  const sinceTick = Number.isFinite(Number(body?.sinceTick)) ? Number(body.sinceTick) : null

  try {
    const { status, body: roomBody } = await callCoopRoom(env, sessionId, 'poll', {
      characterId: ch.id,
      ...(sinceTick === null ? {} : { sinceTick }),
    })
    return json(roomBody ?? { error: 'coop_room_unavailable' }, status)
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
