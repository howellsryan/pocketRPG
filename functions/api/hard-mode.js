import { requireAuth, json } from '../_lib/auth.js'
import { auditLog } from '../_lib/game/audit.js'
import {
  HARD_MODE_SOURCE_TYPES,
  hardModeTarget,
  listHardModeTargets,
  setHardModeTarget,
} from '../_lib/game/hardMode.js'

// The character's Hard Mode switches. The rows this endpoint writes are what the
// reward rollers read on a kill (§14), so the write is authenticated and scoped
// to a character the caller owns, exactly like every other grant-adjacent route.
// It moves no value itself: nothing here grants an item or debits a credit.
async function resolveCharacter(request, env, identityId) {
  const url = new URL(request.url)
  const idStr = request.headers.get('X-Character-Id') || url.searchParams.get('character_id')
  if (!idStr) return { error: 'Missing X-Character-Id header', status: 400 }
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return { error: 'Invalid character id', status: 400 }
  const row = await env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL',
  ).bind(id, identityId).first()
  if (!row) return { error: 'Character not found', status: 404 }
  return { id }
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)
  const ch = await resolveCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)
  return json({ entries: await listHardModeTargets(env, ch.id) })
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)
  const ch = await resolveCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const body = await request.json().catch(() => null)
  const sourceType = typeof body?.sourceType === 'string' ? body.sourceType : null
  const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : null
  if (!sourceType || !HARD_MODE_SOURCE_TYPES.has(sourceType) || !sourceId) {
    return json({ error: 'Invalid target', code: 'INVALID_HARD_MODE_TARGET' }, 400)
  }
  if (!hardModeTarget(sourceType, sourceId)) {
    return json({ error: 'That fight has no hard mode', code: 'HARD_MODE_UNAVAILABLE' }, 400)
  }
  const enabled = body?.enabled === true

  await setHardModeTarget(env, ch.id, sourceType, sourceId, enabled)
  await auditLog(env, 'hard_mode_toggle', {
    characterId: ch.id, identityId: auth.identity.id, sourceType, sourceId, enabled,
  }, { swallow: true })
  return json({ ok: true, sourceType, sourceId, enabled })
}
