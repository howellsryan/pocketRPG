import { requireAuth, json } from '../../../_lib/auth.js'
import { assertNotInActiveMatch } from '../../../_lib/pvp.js'
import { loadCharacterWithSave, writeSave } from '../../../_lib/game/save.js'
import { applyRewardClaim, validateRewardClaimPayload } from '../../../_lib/game/rewardClaim.js'
import { auditLog } from '../../../_lib/game/audit.js'
import { toErrorResponse } from '../../../_lib/game/errors.js'

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  try {
    const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
    if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)

    const lock = await assertNotInActiveMatch(env, characterId)
    if (lock) return lock

    const body = await request.json()
    const claim = validateRewardClaimPayload(body)
    const { saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, auth.identity.id)
    const applied = applyRewardClaim(saveObject, { ...claim, slayerPoints: body?.slayerPoints, dungeoneeringTokens: body?.dungeoneeringTokens })
    const write = await writeSave(env, characterId, saveObject, saveRevision)

    auditLog('protected_reward_claim', { characterId, sourceType: claim.sourceType, sourceId: claim.sourceId, rewardCount: applied.granted.length })

    return json({ ok: true, sourceType: claim.sourceType, sourceId: claim.sourceId, ...applied, updatedAt: write.updatedAt, save_revision: write.saveRevision })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
