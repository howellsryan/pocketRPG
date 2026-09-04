import { requireAuth, json } from '../_lib/auth.js'
import { assertNotInCoopSession } from '../_lib/game/coopBoss.js'
import { auditLog } from '../_lib/game/audit.js'

export const BOSS_RAID_SKIP_MESSAGE = 'Bosses and raids cannot be skipped.'
export const BOSS_RAID_SKIP_CODE = 'BOSS_RAID_SKIP_DISABLED'

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
  if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)

  let body = {}
  try { body = await request.json() } catch { body = {} }
  try {
    const character = await env.DB.prepare(
      'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
    ).bind(characterId, auth.identity.id).first()
    if (!character) return json({ error: 'Character not found' }, 404)

    // Boss and raid kills must be earned through combat. Keep this rejection at
    // the server boundary as well as the client flow so a direct API/MCP call
    // cannot spend credits to unlock the old instant-kill path.
    if (body?.bossId || body?.raidId) {
      return json({ error: BOSS_RAID_SKIP_MESSAGE, code: BOSS_RAID_SKIP_CODE }, 409)
    }

    // A co-op boss fight owns this save: the room is mutating the pack tick by
    // tick and replays its snapshot on write-back.
    const coopLock = await assertNotInCoopSession(env, characterId)
    if (coopLock) return coopLock

    const cost = 1
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
      bossId: null,
      raidId: null,
      credits_remaining: debit.credits_remaining ?? 0,
    }, { swallow: true })

    return json({ ok: true, credits_remaining: debit.credits_remaining ?? 0, cost })
  } catch (err) {
    console.error('[PocketRPG] Skip hour error:', err)
    return json({ error: 'Server error processing skip' }, 500)
  }
}
