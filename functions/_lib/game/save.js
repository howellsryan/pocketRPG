import { decodeSaveRow, gzipJsonString } from '../saveCodec.js'
import { GameApiError } from './errors.js'
import { migrateLegacyNonces } from './nonces.js'
import { computeSaveSummary } from '../saveSummary.js'

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
 */
export async function writeSave(env, characterId, saveObject, expectedRevision, { auditEvent = null } = {}) {
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
  const updateRes = auditEvent
    ? (await env.DB.batch([updateStmt, auditStatement(env, auditEvent, now, characterId, expectedRevision + 1)]))[0]
    : await updateStmt.run()
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
