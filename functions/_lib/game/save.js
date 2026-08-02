import { decodeSaveRow, gzipJsonString } from '../saveCodec.js'
import { GameApiError } from './errors.js'
import { migrateLegacyNonces } from './nonces.js'
import { computeSaveSummary } from '../saveSummary.js'
import { auditLog } from './audit.js'
import { classifyItemLossFromHoldings, mergeDeclaredLosses, readDeclaredLosses, readHoldingsBaseline, rememberHoldingsBaseline } from './holdingsDelta.js'
import { flaggedSaveHistoryStatement, forcedSaveHistoryStatement, routineSaveHistoryStatement } from './saveHistory.js'

const CHARACTER_SAVE_COLUMNS = `c.id, c.owner_id, c.username, c.is_ironman, c.is_one_life, c.credits, s.save_data, s.save_blob, s.updated_at, s.save_revision`

export async function loadCharacterWithSave(env, characterId, identityId) {
  const row = await env.DB.prepare(`SELECT ${CHARACTER_SAVE_COLUMNS} FROM characters c LEFT JOIN saves s ON s.character_id = c.id WHERE c.id = ? AND c.owner_id = ? AND c.deleted_at IS NULL`).bind(characterId, identityId).first()
  return hydrateCharacterSave(env, characterId, row)
}

// Ownership-free variant for /api/admin/* only: an admin acts on a character
// they do not own, so there is no identity to scope the row by. Kept as its own
// named export rather than an option on loadCharacterWithSave so a caller can
// never drop the ownership filter by passing a stray argument.
export async function loadAnyCharacterWithSave(env, characterId) {
  const row = await env.DB.prepare(`SELECT ${CHARACTER_SAVE_COLUMNS} FROM characters c LEFT JOIN saves s ON s.character_id = c.id WHERE c.id = ? AND c.deleted_at IS NULL`).bind(characterId).first()
  return hydrateCharacterSave(env, characterId, row)
}

async function hydrateCharacterSave(env, characterId, row) {
  if (!row) throw new GameApiError('CHARACTER_NOT_FOUND', 'Character not found', 404)
  const decoded = await decodeSaveRow(row)
  const save_data = decoded?.save_data || null
  const saveObject = save_data ? JSON.parse(save_data) : {}
  // One-shot lift of pre-step-6 in-blob nonces to the action_nonces
  // table. INSERT-OR-IGNORE makes it idempotent and safe even if the
  // same save is loaded by concurrent requests.
  await migrateLegacyNonces(env, characterId, saveObject)
  // Measure the holdings NOW: every caller mutates this object in place, so by
  // the time writeSave sees it the "before" is unrecoverable (see holdingsDelta).
  rememberHoldingsBaseline(saveObject)
  return { row, saveObject, saveRevision: Number(row?.save_revision) || 0 }
}

// The audit INSERT only applies if the save actually reached `requiredRevision`,
// which is what ties it to the write it records.
function auditStatement(env, auditEvent, now, characterId, requiredRevision) {
  return env.DB.prepare(
    `INSERT INTO audit_events (event_type, identity_id, character_id, payload_json, created_at)
     SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM saves WHERE character_id = ? AND save_revision = ?)`
  ).bind(
    String(auditEvent.eventType || 'unknown'),
    auditEvent.identityId ?? null,
    characterId,
    JSON.stringify(auditEvent.payload || {}),
    now,
    characterId,
    requiredRevision,
  )
}

/**
 * `auditEvent` ({ eventType, identityId, payload }) makes the audit
 * row commit in the SAME D1 batch as the save write, instead of as a separate
 * best-effort insert afterwards. A privileged mutation whose audit row can be
 * dropped independently is not auditable, so any caller that must never grant
 * unrecorded (admin grants) passes it. The INSERT carries the same revision
 * precondition as the UPDATE, so a lost revision race writes neither row rather
 * than logging a grant that never landed.
 *
 * `baselineFrom` points the item-loss detector at the object
 * loadCharacterWithSave handed out, for the callers that write a REBUILT save
 * rather than the loaded one (co-op's applyMemberToSave). Without it those
 * writes carry no baseline and are silently skipped by the detector.
 *
 * `declaredLosses` ({ itemId: qty }) is what this write deliberately spends —
 * the recipe inputs an idle claim consumed, the supplies it burned. The detector
 * nets it off before thresholding, so ordinary consumption stops reading as
 * destruction. A caller that rebuilds a container wholesale has nothing to
 * declare, which is exactly the case the detector exists to catch.
 */
export async function writeSave(env, characterId, saveObject, expectedRevision, { auditEvent = null, baselineFrom = null, historyReason = null, declaredLosses = null } = {}) {
  if (!Number.isFinite(expectedRevision) || expectedRevision < 0) {
    throw new GameApiError('SAVE_REVISION_REQUIRED', 'save_revision_required', 400)
  }
  const now = Date.now()
  const save_data = JSON.stringify(saveObject)
  const save_blob = await gzipJsonString(save_data)
  const updateStmt = env.DB.prepare(
    `UPDATE saves SET save_blob = ?, save_data = ?, updated_at = ?, save_revision = save_revision + 1
       WHERE character_id = ? AND save_revision = ?`
  ).bind(save_blob, save_data, now, characterId, expectedRevision)

  // Item-loss detection + blob preservation, shadow mode (see
  // docs/item-loss-safety-net.md). Every server-authoritative save writer flows
  // through here, so this is the one place that covers the trading post, the
  // world's grant flush, co-op write-backs, purchases, MCP intents and admin
  // grants at once. It rejects nothing.
  const baseline = readHoldingsBaseline(baselineFrom || saveObject)
  const declared = mergeDeclaredLosses(
    readDeclaredLosses(baselineFrom || saveObject),
    declaredLosses,
  )
  const itemLoss = baseline ? classifyItemLossFromHoldings(baseline, saveObject, undefined, declared) : null
  // `historyReason` forces an unrated snapshot: a write the caller knows is
  // wholesale (an admin restore) must never be the one the routine cadence
  // happens to skip.
  const history = [historyReason
    ? forcedSaveHistoryStatement(env, characterId, historyReason, now)
    : routineSaveHistoryStatement(env, characterId, now)]
  if (itemLoss?.flagged) history.push(flaggedSaveHistoryStatement(env, characterId, now))

  const statements = [...history, updateStmt]
  if (auditEvent) statements.push(auditStatement(env, auditEvent, now, characterId, expectedRevision + 1))
  const updateRes = (await env.DB.batch(statements))[history.length]
  if (itemLoss?.flagged && updateRes?.meta?.changes) {
    await auditLog(env, 'item_loss_detected', {
      characterId,
      source: 'write_save',
      previousRevision: expectedRevision,
      nextRevision: expectedRevision + 1,
      ...itemLoss,
    }, { swallow: true })
  }
  if (!updateRes?.meta?.changes) {
    // No row matched. Either there's no save yet (first write), or a
    // concurrent writer moved the revision forward. Only the first-write
    // case can recover safely, and only when the caller agrees they're
    // writing from a clean slate (expectedRevision === 0).
    if (expectedRevision === 0) {
      const insertRes = await env.DB.prepare(
        `INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT(character_id) DO NOTHING`
      ).bind(characterId, save_blob, save_data, now).run()
      if (!insertRes?.meta?.changes) {
        throw new GameApiError('SAVE_REVISION_CONFLICT', 'save_revision_conflict', 409)
      }
      // The batched audit above was preconditioned on the UPDATE that did not
      // apply, so it wrote nothing. This path created the save instead, and it
      // still has to be recorded — awaited, never swallowed.
      if (auditEvent) await auditStatement(env, auditEvent, now, characterId, 1).run()
    } else {
      throw new GameApiError('SAVE_REVISION_CONFLICT', 'save_revision_conflict', 409)
    }
  }
  // Keep the denormalized leaderboard / PvP-CB columns on `characters` in sync
  // with the save we just wrote. /api/save recomputes these in its own batch;
  // every other server-authoritative save path (MCP create_character, idle
  // claims, purchases, …) flows through here, so without this they'd leave
  // total_level / combat_level stale — a brand-new MCP character would sit at
  // the column default of 0 instead of its real starting total (33).
  const { totalLevel, combatLevel } = computeSaveSummary(saveObject)
  await env.DB.prepare(
    `UPDATE characters SET total_level = ?, combat_level = ? WHERE id = ?`
  ).bind(totalLevel, combatLevel, characterId).run()
  const latest = await env.DB.prepare('SELECT save_revision FROM saves WHERE character_id = ?').bind(characterId).first()
  return { updatedAt: now, saveRevision: Number(latest?.save_revision) || 0 }
}
