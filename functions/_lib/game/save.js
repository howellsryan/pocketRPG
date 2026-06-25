import { decodeSaveRow, gzipJsonString } from '../saveCodec.js'
import { GameApiError } from './errors.js'
import { migrateLegacyNonces } from './nonces.js'
import { computeSaveSummary } from '../saveSummary.js'

export async function loadCharacterWithSave(env, characterId, identityId) {
  const row = await env.DB.prepare(`SELECT c.id, c.owner_id, c.is_ironman, c.is_one_life, c.credits, s.save_data, s.save_blob, s.updated_at, s.save_revision FROM characters c LEFT JOIN saves s ON s.character_id = c.id WHERE c.id = ? AND c.owner_id = ? AND c.deleted_at IS NULL`).bind(characterId, identityId).first()
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

export async function writeSave(env, characterId, saveObject, expectedRevision) {
  if (!Number.isFinite(expectedRevision) || expectedRevision < 0) {
    throw new GameApiError('SAVE_REVISION_REQUIRED', 'save_revision_required', 400)
  }
  const now = Date.now()
  const save_data = JSON.stringify(saveObject)
  const save_blob = await gzipJsonString(save_data)
  const updateRes = await env.DB.prepare(
    `UPDATE saves SET save_blob = ?, save_data = ?, updated_at = ?, save_revision = save_revision + 1
       WHERE character_id = ? AND save_revision = ?`
  ).bind(save_blob, save_data, now, characterId, expectedRevision).run()
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
