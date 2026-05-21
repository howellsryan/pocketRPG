import { requireAuth, json } from '../_lib/auth.js'
import { assertNotInActiveMatch } from '../_lib/pvp.js'
import { auditLog } from '../_lib/game/audit.js'

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
  if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)

  try {
    const character = await env.DB.prepare(
      'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
    ).bind(characterId, auth.identity.id).first()
    if (!character) return json({ error: 'Character not found' }, 404)

    const lock = await assertNotInActiveMatch(env, characterId)
    if (lock) return lock

    const debit = await env.DB.prepare(`
      UPDATE characters
      SET credits = credits - 1
      WHERE id = ?
        AND owner_id = ?
        AND deleted_at IS NULL
        AND credits >= 1
      RETURNING credits AS credits_remaining
    `).bind(characterId, auth.identity.id).first()

    if (!debit) return json({ error: 'Insufficient credits' }, 402)

    await auditLog(env, 'skip_hour.spent', {
      characterId,
      identityId: auth.identity.id,
      credits_remaining: debit.credits_remaining ?? 0,
    }, { swallow: true })

    return json({ ok: true, credits_remaining: debit.credits_remaining ?? 0 })
  } catch (err) {
    console.error('[PocketRPG] Skip hour error:', err)
    return json({ error: 'Server error processing skip' }, 500)
  }
}
