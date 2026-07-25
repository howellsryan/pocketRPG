import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../../_lib/pvp.js'
import { callCoopRoom, coopRoomsAvailable } from '../../../../_lib/game/coopRoom.js'
import { closeCoopMembership, leaveCoopSession, parseCoopSessionId } from '../../../../_lib/game/coopBoss.js'
import { toErrorResponse } from '../../../../_lib/game/errors.js'

/**
 * Leaves a fight.
 *
 * While the room is alive it owns this character's pack and XP in memory, so
 * the write-back has to happen INSIDE it — a D1-side write-back would be
 * overwritten by the room's next checkpoint. The D1 path below is the fallback
 * for a session whose room is already gone (evicted, or ended).
 */
export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const sessionId = parseCoopSessionId(params.id)
  if (sessionId === null) return json({ error: 'Invalid session id' }, 400)

  try {
    if (coopRoomsAvailable(env)) {
      const { status } = await callCoopRoom(env, sessionId, 'depart', { characterId: ch.id })
      // 200 = the room wrote them back and dropped them. 403/404 = the room has
      // no record of this member (already ejected, or the session ended), so
      // fall through to the D1 path, which is idempotent.
      if (status === 200) {
        await closeCoopMembership(env, sessionId, ch.id)
        return json({ ok: true })
      }
    }
    await leaveCoopSession(env, { characterId: ch.id, identityId: auth.identity.id, sessionId })
    return json({ ok: true })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
