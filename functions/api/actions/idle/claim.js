import { requireAuth, json } from '../../../_lib/auth.js'
import { assertNotInCoopSession } from '../../../_lib/game/coopBoss.js'
import { loadCharacterWithSave, writeSave } from '../../../_lib/game/save.js'
import { validateIdleClaimWindow, applyIdleClaimRewards } from '../../../_lib/game/idleClaim.js'
import { toErrorResponse } from '../../../_lib/game/errors.js'
import { auditLog } from '../../../_lib/game/audit.js'

async function consumeSkipCredit(env, characterId, identityId) {
  const row = await env.DB.prepare(`UPDATE characters SET credits = credits - 1, credits_used = credits_used + 1 WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND credits >= 1 RETURNING credits`).bind(characterId, identityId).first()
  if (!row) throw new Error('INSUFFICIENT_CREDITS')
  return row.credits
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  try {
    const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
    if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)

    // A co-op boss fight owns this save: the room is mutating the pack tick by
    // tick and replays its snapshot on write-back.
    const coopLock = await assertNotInCoopSession(env, characterId)
    if (coopLock) return coopLock

    const body = await request.json()
    const idleRow = await env.DB.prepare('SELECT last_active_at, updated_at FROM character_idle_state WHERE character_id = ?').bind(characterId).first()
    if (!idleRow) return json({ error: 'Idle state not found', code: 'IDLE_STATE_NOT_FOUND' }, 404)

    if (Number.isFinite(body?.expectedIdleUpdatedAt) && Number(body.expectedIdleUpdatedAt) !== Number(idleRow.updated_at)) {
      return json({ error: 'idle_stale_claim', code: 'IDLE_STALE_CLAIM' }, 409)
    }

    const isSkipHour = body?.isSkipHour === true
    const elapsedMs = validateIdleClaimWindow({
      lastActiveAt: idleRow.last_active_at,
      serverNow: Date.now(),
      expectedLastActiveAt: body?.expectedLastActiveAt,
      isSkipHour,
    })

    if (isSkipHour) {
      try { await consumeSkipCredit(env, characterId, auth.identity.id) } catch { return json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402) }
    }

    const { saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, auth.identity.id)
    const granted = applyIdleClaimRewards(saveObject, body?.claimRewards || {}, elapsedMs)
    const write = await writeSave(env, characterId, saveObject, saveRevision)

    const now = Date.now()
    await env.DB.prepare('UPDATE character_idle_state SET last_active_at = ?, updated_at = ? WHERE character_id = ?').bind(now, now, characterId).run()

    await auditLog(env, 'idle_claim', { characterId, identityId: auth.identity.id, elapsedMs, isSkipHour, coins: granted.grantedCoins, itemCount: granted.grantedItems.length }, { swallow: true })
    return json({ ok: true, elapsedMs, ...granted, updatedAt: write.updatedAt, save_revision: write.saveRevision })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
