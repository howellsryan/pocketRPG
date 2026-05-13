import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInActiveMatch } from '../../_lib/pvp.js'
import { loadCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { settleActionCompletion } from '../../_lib/game/actionCompletion.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import { auditLog } from '../../_lib/game/audit.js'
import raidsData from '../../../src/data/raids.json' assert { type: 'json' }
import cluesData from '../../../src/data/clues.json' assert { type: 'json' }
import minigamesData from '../../../src/data/minigames.json' assert { type: 'json' }
import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
import { isValidEntry } from '../../_lib/collectionLog.js'



async function persistCollectionLogFromGranted(env, characterId, sourceType, sourceId, granted) {
  if (!env?.DB || !characterId || !sourceType || !sourceId) return
  if (!Array.isArray(granted) || granted.length === 0) return
  const uniqueItemIds = [...new Set(granted.map(g => g?.itemId).filter(Boolean))]
  const entries = uniqueItemIds
    .filter(itemId => isValidEntry(sourceType, sourceId, itemId))
    .map(itemId => ({ itemId, sourceType, sourceId }))
  if (entries.length === 0) return
  const now = Date.now()
  const stmts = entries.map(e => env.DB.prepare(
    `INSERT INTO collection_log (character_id, item_id, source_type, source_id, obtained_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(character_id, item_id, source_type, source_id) DO NOTHING`
  ).bind(characterId, e.itemId, e.sourceType, e.sourceId, now))
  await env.DB.batch(stmts)
}

const VALID_SOURCE_IDS = {
  raids: new Set(Object.keys(raidsData || {})),
  clues: new Set(Object.keys(cluesData || {})),
  minigames: new Set((minigamesData?.tasks || []).map(t => t?.id).filter(Boolean)),
  slayer: new Set(['slayer']),
  dungeoneering: new Set(['dungeoneering']),
  monsters: new Set(Object.keys(monstersData || {})),
}

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
      const validIds = VALID_SOURCE_IDS[sourceType]
      if (validIds && !validIds.has(sourceId)) return json({ error: 'Invalid sourceId', code: 'INVALID_SOURCE_ID' }, 403)

      const resolvedRewards = typeof deps.resolveRewards === 'function'
        ? deps.resolveRewards({ sourceType, sourceId, body })
        : (Array.isArray(body?.rewards) ? body.rewards : [])
      const { saveObject, saveRevision } = await (deps.loadCharacterWithSave || loadCharacterWithSave)(env, characterId, auth.identity.id)
      const settled = settleActionCompletion(saveObject, {
        sourceType,
        sourceId,
        nonce: body?.actionNonce,
        rewards: resolvedRewards,
        consumptions: Array.isArray(body?.consumptions) ? body.consumptions : [],
        slayerPoints: body?.slayerPoints,
        dungeoneeringTokens: body?.dungeoneeringTokens,
      })
      await persistCollectionLogFromGranted(env, characterId, sourceType, sourceId, settled.granted)
      const write = await (deps.writeSave || writeSave)(env, characterId, saveObject, saveRevision)

      auditLog('action_complete', { sourceType, sourceId, characterId, granted: settled.granted.length })
      return json({ ok: true, sourceType, sourceId, ...settled, save: { save_data: JSON.stringify(saveObject), updatedAt: write.updatedAt, save_revision: write.saveRevision } })
    } catch (err) {
      const mapped = toErrorResponse(err)
      return json(mapped.body, mapped.status)
    }
  }
}
