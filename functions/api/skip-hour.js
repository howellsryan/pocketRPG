import { requireAuth, json } from '../_lib/auth.js'
import { assertNotInActiveMatch } from '../_lib/pvp.js'
import { auditLog } from '../_lib/game/audit.js'
import monstersData from '../../src/data/monsters.json' assert { type: 'json' }

// Server-authoritative skip cost. A boss/raid instant-kill skip costs the
// monster's `skipCost` (defaults to 1); a normal 1-hour skip costs 1.
function resolveSkipCost(bossId) {
  if (!bossId || typeof bossId !== 'string') return 1
  const cost = monstersData[bossId]?.skipCost
  return Number.isFinite(cost) && cost > 0 ? Math.floor(cost) : 1
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
  if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)

  let body = {}
  try { body = await request.json() } catch { body = {} }
  const cost = resolveSkipCost(body?.bossId)

  try {
    const character = await env.DB.prepare(
      'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
    ).bind(characterId, auth.identity.id).first()
    if (!character) return json({ error: 'Character not found' }, 404)

    const lock = await assertNotInActiveMatch(env, characterId)
    if (lock) return lock

    const debit = await env.DB.prepare(`
      UPDATE characters
      SET credits = credits - ?1,
          credits_used = credits_used + ?1
      WHERE id = ?2
        AND owner_id = ?3
        AND deleted_at IS NULL
        AND credits >= ?1
      RETURNING credits AS credits_remaining
    `).bind(cost, characterId, auth.identity.id).first()

    if (!debit) return json({ error: 'Insufficient credits' }, 402)

    await auditLog(env, 'skip_hour.spent', {
      characterId,
      identityId: auth.identity.id,
      cost,
      bossId: body?.bossId || null,
      credits_remaining: debit.credits_remaining ?? 0,
    }, { swallow: true })

    return json({ ok: true, credits_remaining: debit.credits_remaining ?? 0, cost })
  } catch (err) {
    console.error('[PocketRPG] Skip hour error:', err)
    return json({ error: 'Server error processing skip' }, 500)
  }
}
