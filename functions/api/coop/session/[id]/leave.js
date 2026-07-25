import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../../_lib/pvp.js'
import { leaveCoopSession } from '../../../../_lib/game/coopBoss.js'
import { toErrorResponse } from '../../../../_lib/game/errors.js'

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const sessionId = parseInt(params.id, 10)
  if (!Number.isFinite(sessionId)) return json({ error: 'Invalid session id' }, 400)

  try {
    await leaveCoopSession(env, { characterId: ch.id, identityId: auth.identity.id, sessionId })
    return json({ ok: true })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
