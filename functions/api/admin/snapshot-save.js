// POST /api/admin/snapshot-save — take the routine save-history snapshot NOW.
//
// Same snapshot the 6h cadence takes (functions/_lib/game/saveHistory.js), on
// demand: an admin about to touch an account, or looking at one mid-incident,
// should not have to wait out a clock for the state to be preserved.
//
// Deliberately does NOT check the save locks, unlike the grant and restore
// endpoints. Those write the save and must not race its owner; this only reads
// the stored row and copies it. A character mid-world-session or mid-co-op
// fight is precisely when a snapshot is worth having.
import { json } from '../../_lib/auth.js'
import { isAdminRequest } from '../../_lib/adminAuth.js'
import { takeManualSaveHistory } from '../../_lib/game/saveHistory.js'
import { auditLog } from '../../_lib/game/audit.js'
import { toErrorResponse } from '../../_lib/game/errors.js'

export async function onRequestPost({ request, env }) {
  if (!isAdminRequest(request, env)) return json({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401)

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400)
    }

    const characterId = Math.floor(Number(body?.character_id) || 0)
    if (!Number.isInteger(characterId) || characterId <= 0) {
      return json({ error: 'character_id must be a positive integer', code: 'INVALID_CHARACTER_ID' }, 400)
    }

    const row = await env.DB.prepare(
      `SELECT c.id, c.owner_id, c.username, s.save_revision
         FROM characters c LEFT JOIN saves s ON s.character_id = c.id
        WHERE c.id = ? AND c.deleted_at IS NULL`
    ).bind(characterId).first()
    if (!row) return json({ error: 'Character not found', code: 'CHARACTER_NOT_FOUND' }, 404)

    const now = Date.now()
    const taken = await takeManualSaveHistory(env, characterId, now)
    if (!taken) {
      return json({ error: 'Character has no save yet', code: 'SAVE_NOT_FOUND' }, 409)
    }

    await auditLog(env, 'admin_save_snapshot', {
      characterId,
      ownerId: row.owner_id,
      saveRevision: Number(row.save_revision) || 0,
      reason: typeof body?.reason === 'string' ? body.reason.slice(0, 200) : null,
    }, { swallow: true })

    return json({
      ok: true,
      character_id: characterId,
      username: row.username,
      save_revision: Number(row.save_revision) || 0,
      created_at: now,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
