import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInActiveMatch } from '../../_lib/pvp.js'
import { loadCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { settleActionCompletion } from '../../_lib/game/actionCompletion.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import { auditLog } from '../../_lib/game/audit.js'

export function makeCompletionHandler(sourceType, deps = {}) {
  return async function onRequestPost({ request, env }) {
    const auth = await (deps.requireAuth || requireAuth)(request, env)
    if (auth.error) return json({ error: auth.error }, auth.status)

    try {
      const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
      if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)

      const lock = await (deps.assertNotInActiveMatch || assertNotInActiveMatch)(env, characterId)
      if (lock) return lock

      const body = await request.json()
      const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : null
      if (!sourceId) return json({ error: 'Missing sourceId', code: 'INVALID_SOURCE_ID' }, 400)

      const { saveObject, saveRevision } = await (deps.loadCharacterWithSave || loadCharacterWithSave)(env, characterId, auth.identity.id)
      const settled = settleActionCompletion(saveObject, {
        sourceType,
        sourceId,
        nonce: body?.actionNonce,
        rewards: Array.isArray(body?.rewards) ? body.rewards : [],
        consumptions: Array.isArray(body?.consumptions) ? body.consumptions : [],
        slayerPoints: body?.slayerPoints,
        dungeoneeringTokens: body?.dungeoneeringTokens,
      })
      const write = await (deps.writeSave || writeSave)(env, characterId, saveObject, saveRevision)

      auditLog('action_complete', { sourceType, sourceId, characterId, granted: settled.granted.length })
      return json({ ok: true, sourceType, sourceId, ...settled, save: { save_data: JSON.stringify(saveObject), updatedAt: write.updatedAt, save_revision: write.saveRevision } })
    } catch (err) {
      const mapped = toErrorResponse(err)
      return json(mapped.body, mapped.status)
    }
  }
}
