import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../../_lib/pvp.js'
import { callCoopRoom } from '../../../../_lib/game/coopRoom.js'
import { parseCoopSessionId } from '../../../../_lib/game/coopBoss.js'
import { toErrorResponse } from '../../../../_lib/game/errors.js'
import { validateCoopAction } from '../../../../_lib/game/coopIntent.js'

// Re-exported because this used to be the validator's home and it is still the
// obvious place to look for it. The socket transport reaches the room without
// passing through here, so the rules themselves live in _lib/game/coopIntent.js.
export { validateCoopAction }

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const sessionId = parseCoopSessionId(params.id)
  if (sessionId === null) return json({ error: 'Invalid session id' }, 400)

  // Malformed JSON is a 400, not the unhandled 500 an un-guarded request.json()
  // produced.
  const body = await request.json().catch(() => null)
  if (body === null) return json({ error: 'invalid_json' }, 400)

  const validated = validateCoopAction(body?.action)
  if (validated.error) return json({ error: validated.error }, 400)

  try {
    const { status, body: roomBody } = await callCoopRoom(env, sessionId, 'intent', {
      characterId: ch.id,
      action: validated.action,
    })
    return json(roomBody ?? { error: 'coop_room_unavailable' }, status)
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
