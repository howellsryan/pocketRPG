import { decodeSaveRow, gzipJsonString } from '../saveCodec.js'
import { GameApiError } from './errors.js'

export async function loadCharacterWithSave(env, characterId, identityId) {
  const row = await env.DB.prepare(`SELECT c.id, c.owner_id, c.is_ironman, c.credits, s.save_data, s.save_blob, s.updated_at, s.save_revision FROM characters c LEFT JOIN saves s ON s.character_id = c.id WHERE c.id = ? AND c.owner_id = ? AND c.deleted_at IS NULL`).bind(characterId, identityId).first()
  if (!row) throw new GameApiError('CHARACTER_NOT_FOUND', 'Character not found', 404)
  const decoded = await decodeSaveRow(row)
  const save_data = decoded?.save_data || null
  return { row, saveObject: save_data ? JSON.parse(save_data) : {}, saveRevision: Number(row?.save_revision) || 0 }
}

export async function writeSave(env, characterId, saveObject, expectedRevision = null) {
  const now = Date.now()
  const save_data = JSON.stringify(saveObject)
  const save_blob = await gzipJsonString(save_data)
  if (expectedRevision == null) {
    await env.DB.prepare(`INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (?, ?, ?, ?, 1) ON CONFLICT(character_id) DO UPDATE SET save_blob = excluded.save_blob, save_data = excluded.save_data, updated_at = excluded.updated_at, save_revision = COALESCE(saves.save_revision, 0) + 1`).bind(characterId, save_blob, save_data, now).run()
  } else {
    const result = await env.DB.prepare(`UPDATE saves SET save_blob = ?, save_data = ?, updated_at = ?, save_revision = save_revision + 1 WHERE character_id = ? AND save_revision = ?`).bind(save_blob, save_data, now, characterId, expectedRevision).run()
    if (!result?.meta?.changes) throw new GameApiError('SAVE_REVISION_CONFLICT', 'save_revision_conflict', 409)
  }
  const latest = await env.DB.prepare('SELECT save_revision FROM saves WHERE character_id = ?').bind(characterId).first()
  return { updatedAt: now, saveRevision: Number(latest?.save_revision) || 0 }
}
