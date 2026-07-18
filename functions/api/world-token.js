import { requireAuth, json } from '../_lib/auth.js'
import { signJWT } from '../_lib/jwt.js'
import { assertNotInActiveMatch } from '../_lib/pvp.js'

const HANDOFF_EXPIRES_SECONDS = 60

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const idStr = request.headers.get('X-Character-Id')
  const characterId = parseInt(idStr || '', 10)
  if (!Number.isFinite(characterId)) return json({ error: 'Missing X-Character-Id header' }, 400)

  const row = await env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(characterId, auth.identity.id).first()
  if (!row) return json({ error: 'Character not found' }, 404)

  // Never hand off into the world while a PvP match is active — the world flush
  // path mutates the save and would bypass the match's save-lockdown (§10/§14).
  const lock = await assertNotInActiveMatch(env, row.id)
  if (lock) return lock

  const handoff = await signJWT(
    { sub: auth.identity.id, character_id: row.id, scope: 'world_handoff' },
    env.JWT_SECRET,
    HANDOFF_EXPIRES_SECONDS
  )
  return json({ handoff })
}
