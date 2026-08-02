// GET /api/admin/item-loss — every item_loss_detected audit event, joined to
// the snapshot that can undo it.
//
// The detector runs in shadow mode and rejects nothing, so these rows are the
// whole product of Phase 2: a queue of losses to look at. Read side only —
// nothing here writes.
//
// Authorization is the ADMIN_SECRET (functions/_lib/adminAuth.js), as every
// /api/admin/* route.
import { json } from '../../_lib/auth.js'
import { isAdminRequest } from '../../_lib/adminAuth.js'
import {
  ITEM_LOSS_EVENT,
  SAVE_RESTORE_EVENT,
  clampIncidentLimit,
  shapeItemLossIncidents,
  summariseIncidents,
} from '../../_lib/game/itemLossReport.js'
import { SAVE_HISTORY_REASON_ITEM_LOSS } from '../../_lib/game/saveHistory.js'
import { toErrorResponse } from '../../_lib/game/errors.js'

function placeholders(n) {
  return new Array(n).fill('?').join(', ')
}

export async function onRequestGet({ request, env }) {
  if (!isAdminRequest(request, env)) return json({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401)

  try {
    const url = new URL(request.url)
    const limit = clampIncidentLimit(url.searchParams.get('limit'))
    const rawCharacter = url.searchParams.get('character_id')
    const characterId = rawCharacter ? Math.floor(Number(rawCharacter) || 0) : 0
    if (rawCharacter && (!Number.isInteger(characterId) || characterId <= 0)) {
      return json({ error: 'character_id must be a positive integer', code: 'INVALID_CHARACTER_ID' }, 400)
    }

    // idx_audit_events_type_time covers this ordering, so no migration is
    // needed to read the log back.
    const filter = characterId ? ' AND a.character_id = ?' : ''
    const binds = characterId ? [ITEM_LOSS_EVENT, characterId, limit] : [ITEM_LOSS_EVENT, limit]
    const found = await env.DB.prepare(
      `SELECT a.id, a.character_id, a.created_at, a.payload_json, c.username, c.owner_id
         FROM audit_events a
         LEFT JOIN characters c ON c.id = a.character_id
        WHERE a.event_type = ?${filter}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?`
    ).bind(...binds).all()
    const rows = found?.results || []

    // The payload is JSON, so the snapshot/restore joins are resolved in JS
    // rather than with json_extract — the linking rule is worth having under
    // test, and it keeps this off a SQLite extension.
    const ids = [...new Set(rows.map((r) => Number(r.character_id)).filter(Boolean))]
    let snapshots = []
    let restores = []
    let counts = []
    if (ids.length) {
      const marks = placeholders(ids.length)
      const [snapRes, restoreRes, countRes] = await env.DB.batch([
        env.DB.prepare(
          `SELECT id, character_id, save_revision, created_at
             FROM save_history
            WHERE reason = ? AND character_id IN (${marks})
            ORDER BY created_at DESC`
        ).bind(SAVE_HISTORY_REASON_ITEM_LOSS, ...ids),
        env.DB.prepare(
          `SELECT character_id, MAX(created_at) AS restored_at
             FROM audit_events
            WHERE event_type = ? AND character_id IN (${marks})
            GROUP BY character_id`
        ).bind(SAVE_RESTORE_EVENT, ...ids),
        env.DB.prepare(
          `SELECT character_id, COUNT(*) AS n
             FROM audit_events
            WHERE event_type = ? AND character_id IN (${marks})
            GROUP BY character_id`
        ).bind(ITEM_LOSS_EVENT, ...ids),
      ])
      snapshots = snapRes?.results || []
      restores = restoreRes?.results || []
      counts = countRes?.results || []
    }

    const incidents = shapeItemLossIncidents({ rows, snapshots, restores, counts })
    return json({
      ok: true,
      limit,
      character_id: characterId || null,
      summary: summariseIncidents(incidents),
      incidents,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
