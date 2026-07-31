import { requireAuth, json } from '../_lib/auth.js'
import { assertNotInActiveMatch } from '../_lib/pvp.js'
import { assertNotInCoopSession } from '../_lib/game/coopBoss.js'
import { auditLog } from '../_lib/game/audit.js'
import monstersData from '../../src/data/monsters.json' assert { type: 'json' }
import raidsData from '../../src/data/raids.json' assert { type: 'json' }
import { hardModeSkipCost } from '../../src/engine/hardMode.js'
import { isHardModeEnabled } from '../_lib/game/hardMode.js'

// Server-authoritative skip cost. A boss instant-kill skip costs the monster's
// `skipCost`; a full-raid skip costs the raid's `skipCost` (its bosses plus any
// additional forms); a normal 1-hour skip costs 1. All default to 1 credit.
//
// A skip buys the kill's drops without the fight, and hard mode doubles those
// drop rates — so a hard target's skip costs double, read from the server's own
// switch (hard_mode_targets), never from the request.
async function resolveSkipCost(env, characterId, { bossId, raidId } = {}) {
  if (raidId && typeof raidId === 'string') {
    const cost = raidsData[raidId]?.skipCost
    const base = Number.isFinite(cost) && cost > 0 ? Math.floor(cost) : 1
    return hardModeSkipCost(base, await isHardModeEnabled(env, characterId, 'raids', raidId))
  }
  if (bossId && typeof bossId === 'string') {
    const cost = monstersData[bossId]?.skipCost
    const base = Number.isFinite(cost) && cost > 0 ? Math.floor(cost) : 1
    return hardModeSkipCost(base, await isHardModeEnabled(env, characterId, 'monsters', bossId))
  }
  return 1
}

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

    const cost = await resolveSkipCost(env, characterId, { bossId: body?.bossId, raidId: body?.raidId })

    const lock = await assertNotInActiveMatch(env, characterId)
    if (lock) return lock
    // A co-op boss fight owns this save the same way a PvP match does: the room
    // is mutating the pack tick by tick and replays its snapshot on write-back.
    const coopLock = await assertNotInCoopSession(env, characterId)
    if (coopLock) return coopLock

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
      raidId: body?.raidId || null,
      credits_remaining: debit.credits_remaining ?? 0,
    }, { swallow: true })

    return json({ ok: true, credits_remaining: debit.credits_remaining ?? 0, cost })
  } catch (err) {
    console.error('[PocketRPG] Skip hour error:', err)
    return json({ error: 'Server error processing skip' }, 500)
  }
}
