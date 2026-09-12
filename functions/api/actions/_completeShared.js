import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInCoopSession } from '../../_lib/game/coopBoss.js'
import { loadCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { settleActionCompletion } from '../../_lib/game/actionCompletion.js'
import { claimActionNonce } from '../../_lib/game/nonces.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import { auditLog } from '../../_lib/game/audit.js'
import raidsData from '../../../src/data/raids.json' assert { type: 'json' }
import cluesData from '../../../src/data/clues.json' assert { type: 'json' }
import minigamesData from '../../../src/data/minigames.json' assert { type: 'json' }
import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
import { isValidEntry } from '../../_lib/collectionLog.js'



async function persistCollectionLogFromGranted(env, characterId, sourceType, sourceId, granted) {
  if (!env?.DB || !characterId || !sourceType || !sourceId) return []
  if (!Array.isArray(granted) || granted.length === 0) return []
  const uniqueItemIds = [...new Set(granted.map(g => g?.itemId).filter(Boolean))]
  const entries = uniqueItemIds
    .filter(itemId => isValidEntry(sourceType, sourceId, itemId))
    .map(itemId => ({ itemId, sourceType, sourceId }))
  if (entries.length === 0) return []
  const now = Date.now()
  const stmts = entries.map(e => env.DB.prepare(
    `INSERT INTO collection_log (character_id, item_id, source_type, source_id, obtained_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(character_id, item_id, source_type, source_id) DO NOTHING`
  ).bind(characterId, e.itemId, e.sourceType, e.sourceId, now))
  await env.DB.batch(stmts)
  return entries
}

// Server-authoritative boss/raid kill count. Runs only for monster/raid
// completions, and only after the action nonce has been claimed — so a
// replayed completion (same nonce) never reaches here and cannot
// double-increment. Returns the new total for the client to display.
async function persistKillCountFromAction(env, characterId, sourceType, sourceId) {
  if (!env?.DB || !characterId) return null
  if (sourceType !== 'monsters' && sourceType !== 'raids') return null
  if (!sourceId || typeof sourceId !== 'string') return null
  const now = Date.now()
  const row = await env.DB.prepare(
    `INSERT INTO kill_counts (character_id, source_type, source_id, kill_count, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(character_id, source_type, source_id)
     DO UPDATE SET kill_count = kill_count + 1, updated_at = excluded.updated_at
     RETURNING kill_count`
  ).bind(characterId, sourceType, sourceId, now).first()
  const killCount = Math.max(0, Math.floor(Number(row?.kill_count) || 0))
  return { sourceType, sourceId, killCount }
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

      // A co-op boss fight owns this save: the room is mutating the pack tick by
      // tick and replays its snapshot on write-back.
      const coopLock = await (deps.assertNotInCoopSession || assertNotInCoopSession)(env, characterId)
      if (coopLock) return coopLock

      const body = await request.json()
      const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : null
      if (!sourceId) return json({ error: 'Missing sourceId', code: 'INVALID_SOURCE_ID' }, 400)
      const validIds = VALID_SOURCE_IDS[sourceType]
      if (validIds && !validIds.has(sourceId)) return json({ error: 'Invalid sourceId', code: 'INVALID_SOURCE_ID' }, 403)

      // Claim the nonce against the DB before doing anything else.
      // A replay throws STALE_REPLAYED_ACTION which is mapped to 409.
      // The DB-side claim is atomic and independent of save state, so a
      // client that PUTs a stale save cannot resurrect a used nonce.
      await (deps.claimActionNonce || claimActionNonce)(env, characterId, body?.actionNonce)
      const { row, saveObject, saveRevision } = await (deps.loadCharacterWithSave || loadCharacterWithSave)(env, characterId, auth.identity.id)
      // Rewards are resolved after the save loads so server-side reward tables
      // can gate on save state (e.g. task-only drops requiring the character's
      // active slayer task to match the killed monster).
      // env + characterId are handed over so a reward table can gate on state the
      // SERVER owns (hard mode's doubled drop rates, §14) rather than on the body.
      // isGrindman rides the row this load already fetched — the account type is
      // server state too, and a second query for it would be one per kill.
      const isGrindman = row?.is_grindman === 1
      const resolvedRewards = typeof deps.resolveRewards === 'function'
        ? await deps.resolveRewards({ sourceType, sourceId, body, saveObject, env, characterId, isGrindman })
        : (Array.isArray(body?.rewards) ? body.rewards : [])
      const settled = settleActionCompletion(saveObject, {
        sourceType,
        sourceId,
        rewards: resolvedRewards,
        consumptions: Array.isArray(body?.consumptions) ? body.consumptions : [],
        slayerPoints: body?.slayerPoints,
        dungeoneeringTokens: body?.dungeoneeringTokens,
      })
      // The collection-log section id can differ from the completion sourceId.
      // Minigames complete by task id (e.g. `pc_void_set`) but their log slots
      // are keyed by the parent minigame id (e.g. `pest_control`), so handlers
      // can remap via resolveCollectionLogSourceId. Defaults to the sourceId,
      // which is correct for raids/clues/monsters/dungeoneering.
      const collectionLogSourceId = typeof deps.resolveCollectionLogSourceId === 'function'
        ? deps.resolveCollectionLogSourceId({ sourceType, sourceId, body })
        : sourceId
      // Persist the save (which carries the granted item) FIRST. If a concurrent
      // writer bumped the revision between the load above and here, writeSave
      // throws SAVE_REVISION_CONFLICT now — BEFORE we touch the collection_log
      // or kill_counts tables — so a failed completion can never strand a
      // collection-log slot (or a kill-count increment) without the item that
      // earned it. The granted item is irreplaceable; the collection-log entry
      // is idempotent (ON CONFLICT DO NOTHING) and the kill-count is
      // recoverable, so they trail the authoritative save rather than leading it.
      const write = await (deps.writeSave || writeSave)(env, characterId, saveObject, saveRevision)
      const collectionLogEntries = await persistCollectionLogFromGranted(env, characterId, sourceType, collectionLogSourceId, settled.granted)
      const countKill = typeof deps.shouldPersistKillCount === 'function'
        ? deps.shouldPersistKillCount({ sourceType, sourceId, body, saveObject, resolvedRewards, settled })
        : true
      const killCount = countKill
        ? await persistKillCountFromAction(env, characterId, sourceType, sourceId)
        : null

      await auditLog(env, 'action_complete', { sourceType, sourceId, characterId, identityId: auth.identity.id, granted: settled.granted.length }, { swallow: true })
      return json({ ok: true, sourceType, sourceId, ...settled, collectionLogEntries, killCount, save: { save_data: JSON.stringify(saveObject), updatedAt: write.updatedAt, save_revision: write.saveRevision } })
    } catch (err) {
      const mapped = toErrorResponse(err)
      return json(mapped.body, mapped.status)
    }
  }
}
