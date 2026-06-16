import { decodeSaveRow, gzipJsonString } from '../saveCodec.js'
import { GameApiError } from './errors.js'
import { migrateLegacyNonces } from './nonces.js'
import { createDefaultSave } from '../../../src/engine/createDefaultSave.js'

export async function loadCharacterWithSave(env, characterId, identityId) {
  const row = await env.DB.prepare(`SELECT c.id, c.owner_id, c.is_ironman, c.credits, s.save_data, s.save_blob, s.updated_at, s.save_revision FROM characters c LEFT JOIN saves s ON s.character_id = c.id WHERE c.id = ? AND c.owner_id = ? AND c.deleted_at IS NULL`).bind(characterId, identityId).first()
  if (!row) throw new GameApiError('CHARACTER_NOT_FOUND', 'Character not found', 404)
  const decoded = await decodeSaveRow(row)
  const save_data = decoded?.save_data || null
  // A character with no save row (created server-side via the MCP
  // create_character tool and never opened in the browser) gets the canonical
  // fresh-character baseline instead of an empty {}. Otherwise every skill
  // reads as uninitialized and idle XP is silently dropped on claim. The first
  // writeSave (expectedRevision 0) persists this baseline plus the new gains.
  const saveObject = save_data ? JSON.parse(save_data) : createDefaultSave()
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
  const latest = await env.DB.prepare('SELECT save_revision FROM saves WHERE character_id = ?').bind(characterId).first()
  return { updatedAt: now, saveRevision: Number(latest?.save_revision) || 0 }
}
