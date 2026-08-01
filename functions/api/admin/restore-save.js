// GET/POST /api/admin/restore-save — list, inspect and restore a character's
// preserved save blobs (functions/_lib/game/saveHistory.js).
//
// This is the recovery half of the item-loss safety net: the detector reports
// and the history table preserves, but neither gives a player their bank back.
// This does.
//
// Authorization is the ADMIN_SECRET only (functions/_lib/adminAuth.js), exactly
// as /api/admin/grant-item — a session JWT grants nothing here. It observes the
// same three save locks and the same revision guard, because a restore written
// underneath a live owner is the very failure the whole feature exists to stop.
import { json } from '../../_lib/auth.js'
import { isAdminRequest } from '../../_lib/adminAuth.js'
import { assertNotInCoopSession } from '../../_lib/game/coopBoss.js'
import { isWorldSessionLive } from '../../_lib/game/worldSessions.js'
import { loadAnyCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { getSaveHistoryEntry, listSaveHistory } from '../../_lib/game/saveHistory.js'
import { classifyItemLoss, summariseHoldings } from '../../_lib/game/holdingsDelta.js'
import { decodeSaveRow } from '../../_lib/saveCodec.js'
import { toErrorResponse } from '../../_lib/game/errors.js'

function parseId(value) {
  const id = Math.floor(Number(value) || 0)
  return Number.isInteger(id) && id > 0 ? id : null
}

async function decodeHistoryEntry(entry) {
  // decodeSaveRow reads the same two columns the history table copies verbatim
  // off `saves`, so a snapshot decodes exactly as the live row would.
  const decoded = await decodeSaveRow(entry)
  const text = decoded?.save_data || entry?.save_data || null
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

export async function onRequestGet({ request, env }) {
  if (!isAdminRequest(request, env)) return json({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401)

  try {
    const url = new URL(request.url)
    const characterId = parseId(url.searchParams.get('character_id'))
    if (!characterId) {
      return json({ error: 'character_id must be a positive integer', code: 'INVALID_CHARACTER_ID' }, 400)
    }

    const historyId = parseId(url.searchParams.get('history_id'))
    if (!historyId) {
      const { row, saveObject } = await loadAnyCharacterWithSave(env, characterId)
      return json({
        ok: true,
        character_id: characterId,
        username: row.username,
        current: {
          save_revision: Number(row.save_revision) || 0,
          updated_at: Number(row.updated_at) || null,
          holdings: summariseHoldings(saveObject),
        },
        snapshots: await listSaveHistory(env, characterId, url.searchParams.get('limit')),
      })
    }

    const entry = await getSaveHistoryEntry(env, characterId, historyId)
    if (!entry) return json({ error: 'Snapshot not found', code: 'SNAPSHOT_NOT_FOUND' }, 404)
    const snapshot = await decodeHistoryEntry(entry)
    if (!snapshot) return json({ error: 'Snapshot could not be decoded', code: 'SNAPSHOT_DECODE_FAILED' }, 400)

    const { saveObject } = await loadAnyCharacterWithSave(env, characterId)
    return json({
      ok: true,
      character_id: characterId,
      snapshot: {
        id: entry.id,
        save_revision: entry.save_revision,
        created_at: entry.created_at,
        reason: entry.reason,
        holdings: summariseHoldings(snapshot),
      },
      current_holdings: summariseHoldings(saveObject),
      // What the live save has lost relative to this snapshot — the direct
      // answer to "is this the one from before it went missing".
      lost_since_snapshot: classifyItemLoss(snapshot, saveObject),
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}

export async function onRequestPost({ request, env }) {
  if (!isAdminRequest(request, env)) return json({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401)

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400)
    }

    const characterId = parseId(body?.character_id)
    if (!characterId) {
      return json({ error: 'character_id must be a positive integer', code: 'INVALID_CHARACTER_ID' }, 400)
    }
    const historyId = parseId(body?.history_id)
    if (!historyId) {
      return json({ error: 'history_id must be a positive integer', code: 'INVALID_HISTORY_ID' }, 400)
    }

    const coopLock = await assertNotInCoopSession(env, characterId)
    if (coopLock) return coopLock
    if (await isWorldSessionLive(env, characterId)) {
      return json({ error: 'character_in_world_session', code: 'CHARACTER_IN_WORLD_SESSION' }, 409)
    }

    const entry = await getSaveHistoryEntry(env, characterId, historyId)
    if (!entry) return json({ error: 'Snapshot not found', code: 'SNAPSHOT_NOT_FOUND' }, 404)
    const snapshot = await decodeHistoryEntry(entry)
    if (!snapshot) return json({ error: 'Snapshot could not be decoded', code: 'SNAPSHOT_DECODE_FAILED' }, 400)

    const { row, saveObject, saveRevision } = await loadAnyCharacterWithSave(env, characterId)
    // No live save row means the character was never synced, or a One-Life
    // death deleted it. Writing here would resurrect a run that is over — the
    // same refusal /api/admin/grant-item makes, for the same reason.
    if (!row.save_blob && !row.save_data) {
      return json({ error: 'Character has no save yet', code: 'SAVE_NOT_FOUND' }, 409)
    }

    const restoring = classifyItemLoss(snapshot, saveObject)
    const discarding = classifyItemLoss(saveObject, snapshot)

    if (body?.dry_run === true) {
      return json({
        ok: true,
        dry_run: true,
        character_id: characterId,
        username: row.username,
        history_id: entry.id,
        snapshot_revision: entry.save_revision,
        snapshot_created_at: entry.created_at,
        save_revision: saveRevision,
        restores: restoring,
        discards: discarding,
      })
    }

    // Forward, never backward: the snapshot's CONTENT is written as the next
    // revision rather than rewinding save_revision. A rewind would hand the
    // player's client a revision it has already pushed past, and its next save
    // would be refused as stale for as long as it stayed behind.
    const write = await writeSave(env, characterId, snapshot, saveRevision, {
      // Preserve what the restore overwrites, unconditionally and before it
      // lands: a restore to the wrong snapshot has to be undoable too.
      historyReason: 'pre_restore',
      baselineFrom: saveObject,
      auditEvent: {
        eventType: 'admin_save_restore',
        identityId: null,
        payload: {
          characterId,
          ownerId: row.owner_id,
          historyId: entry.id,
          snapshotRevision: entry.save_revision,
          snapshotCreatedAt: entry.created_at,
          snapshotReason: entry.reason,
          fromRevision: saveRevision,
          restores: restoring,
          discards: discarding,
          reason: typeof body?.reason === 'string' ? body.reason.slice(0, 200) : null,
        },
      },
    })

    return json({
      ok: true,
      character_id: characterId,
      username: row.username,
      history_id: entry.id,
      snapshot_revision: entry.save_revision,
      restores: restoring,
      discards: discarding,
      updatedAt: write.updatedAt,
      save_revision: write.saveRevision,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
