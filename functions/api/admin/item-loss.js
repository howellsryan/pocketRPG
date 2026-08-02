// GET /api/admin/item-loss — every item_loss_detected audit event, joined to
// the snapshot that can undo it.
// POST /api/admin/item-loss — file the admin's verdict on one of them.
//
// The detector runs in shadow mode and rejects nothing, so these rows are the
// whole product of Phase 2: a queue of losses to look at. The POST writes only
// to item_loss_reviews — no save, no audit payload, nothing the detector reads
// — so the portal's Server tab stays true to "nothing here writes to a save".
//
// Authorization is the ADMIN_SECRET (functions/_lib/adminAuth.js), as every
// /api/admin/* route.
import { json } from '../../_lib/auth.js'
import { isAdminRequest } from '../../_lib/adminAuth.js'
import {
  ITEM_LOSS_EVENT,
  REVIEW_OPEN,
  SAVE_RESTORE_EVENT,
  clampIncidentLimit,
  clampReviewNote,
  normaliseReviewFilter,
  normaliseReviewStatus,
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

    const review = normaliseReviewFilter(url.searchParams.get('review'))

    // idx_audit_events_type_time covers this ordering, so no migration is
    // needed to read the log back.
    const binds = [ITEM_LOSS_EVENT]
    let filter = ''
    if (characterId) {
      filter += ' AND a.character_id = ?'
      binds.push(characterId)
    }
    // The verdict filter runs HERE and not over the shaped rows: filtering
    // after the LIMIT would silently return a short page every time something
    // recent was dismissed.
    if (review === 'dismissed' || review === 'confirmed') {
      filter += ' AND r.status = ?'
      binds.push(review)
    } else if (review !== 'all') {
      filter += " AND (r.status IS NULL OR r.status <> 'dismissed')"
    }
    binds.push(limit)
    const found = await env.DB.prepare(
      `SELECT a.id, a.character_id, a.created_at, a.payload_json, c.username, c.owner_id,
              r.status AS review_status, r.note AS review_note, r.reviewed_at AS reviewed_at
         FROM audit_events a
         LEFT JOIN characters c ON c.id = a.character_id
         LEFT JOIN item_loss_reviews r ON r.audit_event_id = a.id
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
        // Dismissed flags are excluded so "incidents on this account" keeps
        // meaning incidents rather than detector noise.
        env.DB.prepare(
          `SELECT a.character_id, COUNT(*) AS n
             FROM audit_events a
             LEFT JOIN item_loss_reviews r ON r.audit_event_id = a.id
            WHERE a.event_type = ? AND a.character_id IN (${marks})
              AND (r.status IS NULL OR r.status <> 'dismissed')
            GROUP BY a.character_id`
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
      review,
      summary: summariseIncidents(incidents),
      incidents,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}

/**
 * Files a verdict on one flagged write: `dismissed` for a detector false
 * positive, `confirmed` for a real loss, `open` to undo either.
 *
 * The point is measurement, not tidiness. Shadow mode only ends when real
 * traffic stops producing unexplained flags, and that is unanswerable while
 * "not a loss" and "nobody has looked yet" are the same row.
 */
export async function onRequestPost({ request, env }) {
  if (!isAdminRequest(request, env)) return json({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401)

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400)
    }

    const id = Math.floor(Number(body?.id) || 0)
    if (!Number.isInteger(id) || id <= 0) {
      return json({ error: 'id must be a positive integer', code: 'INVALID_INCIDENT_ID' }, 400)
    }
    const status = normaliseReviewStatus(body?.status)
    if (!status) {
      return json({ error: 'status must be open, dismissed or confirmed', code: 'INVALID_REVIEW_STATUS' }, 400)
    }
    const note = clampReviewNote(body?.note)

    // The id has to name an item_loss_detected row: audit ids are one sequence
    // across every event type, so an off-by-one would otherwise file a verdict
    // against a grant or a restore and quietly poison the measurement.
    const event = await env.DB.prepare(
      'SELECT id, character_id, event_type FROM audit_events WHERE id = ?'
    ).bind(id).first()
    if (!event || event.event_type !== ITEM_LOSS_EVENT) {
      return json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404)
    }

    const reviewedAt = Date.now()
    if (status === REVIEW_OPEN) {
      await env.DB.prepare('DELETE FROM item_loss_reviews WHERE audit_event_id = ?').bind(id).run()
    } else {
      await env.DB.prepare(
        `INSERT INTO item_loss_reviews (audit_event_id, character_id, status, note, reviewed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(audit_event_id) DO UPDATE SET
           status = excluded.status, note = excluded.note, reviewed_at = excluded.reviewed_at`
      ).bind(id, event.character_id ?? null, status, note, reviewedAt).run()
    }

    return json({
      ok: true,
      id,
      character_id: event.character_id ?? null,
      review_status: status,
      review_note: status === REVIEW_OPEN ? null : note,
      reviewed_at: status === REVIEW_OPEN ? null : reviewedAt,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
