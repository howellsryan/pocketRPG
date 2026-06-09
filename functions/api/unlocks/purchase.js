import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInActiveMatch } from '../../_lib/pvp.js'
import { auditLog } from '../../_lib/game/audit.js'

// Registry of purchasable permanent character unlocks.
// Server is authoritative on id → cost so the client can't submit a cheaper price.
const UNLOCK_REGISTRY = {
  double_slayer_xp: { cost: 100, description: 'Double Slayer XP per kill' },
}

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

    let body
    try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

    const unlockId = body?.unlock_id
    const unlock = unlockId ? UNLOCK_REGISTRY[unlockId] : null
    if (!unlock) return json({ error: 'Unknown unlock', code: 'UNKNOWN_UNLOCK' }, 400)

    const debit = await env.DB.prepare(`
      UPDATE characters
      SET credits = credits - ?,
          credits_used = credits_used + ?
      WHERE id = ?
        AND owner_id = ?
        AND deleted_at IS NULL
        AND credits >= ?
      RETURNING credits AS credits_remaining
    `).bind(unlock.cost, unlock.cost, characterId, auth.identity.id, unlock.cost).first()

    if (!debit) return json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402)

    await auditLog(env, 'character_unlock.purchased', {
      characterId,
      identityId: auth.identity.id,
      unlockId,
      cost: unlock.cost,
      credits_remaining: debit.credits_remaining ?? 0,
    }, { swallow: true })

    return json({ ok: true, unlock_id: unlockId, credits_remaining: debit.credits_remaining ?? 0 })
  } catch (err) {
    console.error('[PocketRPG] Unlock purchase error:', err)
    return json({ error: 'Server error processing unlock purchase' }, 500)
  }
}
