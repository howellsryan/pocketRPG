import { requireAuth, json } from '../auth.js'
import { getOwnedCharacter } from '../character.js'
import { assertNotInCoopSession } from './coopBoss.js'
import { toErrorResponse } from './errors.js'

export async function sunspireCharacter(request, env, { requireSoloLock = true } = {}) {
  const auth = await requireAuth(request, env)
  if (auth.error) return { response: json({ error: auth.error }, auth.status) }
  const character = await getOwnedCharacter(request, env, auth.identity.id)
  if (character.error) return { response: json({ error: character.error }, character.status) }
  if (requireSoloLock) {
    const lock = await assertNotInCoopSession(env, character.id)
    if (lock) return { response: lock }
  }
  return { auth, character }
}

export async function sunspireBody(request) {
  return request.json().catch(() => ({}))
}

export function sunspireError(err) {
  const mapped = toErrorResponse(err)
  return json(mapped.body, mapped.status)
}
