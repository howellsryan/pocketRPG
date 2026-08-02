// The investigation view over `item_loss_detected` audit events (Phase 2 of the
// item-loss safety net). The detector writes those rows and rejects nothing, so
// they are only worth writing if somebody reads them — this is the read side,
// surfaced as the /admin Incidents panel.
//
// Shaping is separated from the queries so the join that matters can be tested:
// an incident is only actionable if it can be tied to the SNAPSHOT holding the
// state from just before the loss, and that link is what turns a row in a log
// into a restore.

export const ITEM_LOSS_EVENT = 'item_loss_detected'
export const SAVE_RESTORE_EVENT = 'admin_save_restore'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_NOTE = 200

// A review is a HUMAN VERDICT on a detector flag, and the detector is in shadow
// mode precisely because we do not yet know which flags are real. So both
// answers are recorded, not just the dismissal: a queue where only false
// positives are labelled cannot tell a confirmed incident from one nobody has
// looked at yet, which is the one number Phase 3 needs. Absence of a row is the
// third state, `open` — reopening is a DELETE, so undo leaves no residue.
export const REVIEW_OPEN = 'open'
export const REVIEW_DISMISSED = 'dismissed'
export const REVIEW_CONFIRMED = 'confirmed'
const REVIEW_STATUSES = [REVIEW_OPEN, REVIEW_DISMISSED, REVIEW_CONFIRMED]

export function clampIncidentLimit(raw) {
  const n = Math.floor(Number(raw) || 0)
  if (!n || n < 1) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}

/** The status a caller asked to write. Null means "not one of ours" — refuse
 * rather than default, or a typo silently files the wrong verdict. */
export function normaliseReviewStatus(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return REVIEW_STATUSES.includes(value) ? value : null
}

export function clampReviewNote(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().slice(0, MAX_NOTE)
  return trimmed || null
}

/** Which slice of the queue to list. `active` is the default because a
 * dismissed incident has been dealt with — leaving it in the queue is the whole
 * thing this feature removes. */
export function normaliseReviewFilter(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (value === 'dismissed' || value === 'confirmed' || value === 'all') return value
  return 'active'
}

function parsePayload(json) {
  if (typeof json !== 'string' || !json) return {}
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Joins each incident to the pre-loss snapshot and to whatever has happened
 * since.
 *
 * The snapshot link is `save_revision === previousRevision`: the detector forces
 * an `item_loss` snapshot in the same batch as the write it flagged, and that
 * snapshot preserves the revision being REPLACED. So the incident's
 * previousRevision is exactly the snapshot's save_revision, and matching on it
 * hands the admin the row to restore. It can legitimately be absent — the
 * snapshot is rate-limited to one per 5 minutes per character, so a burst of
 * incidents shares one, and the 14-day retention eventually drops it.
 */
export function shapeItemLossIncidents({ rows = [], snapshots = [], restores = [], counts = [] } = {}) {
  const snapshotByKey = new Map()
  for (const snap of snapshots) {
    // First wins: the query orders newest first, and for a shared snapshot the
    // nearest one to the incident is the one to offer.
    const key = `${snap.character_id}:${snap.save_revision}`
    if (!snapshotByKey.has(key)) snapshotByKey.set(key, snap)
  }
  const restoredAt = new Map()
  for (const row of restores) restoredAt.set(Number(row.character_id), Number(row.restored_at) || 0)
  const incidentCount = new Map()
  for (const row of counts) incidentCount.set(Number(row.character_id), Number(row.n) || 0)

  return rows.map((row) => {
    const payload = parsePayload(row.payload_json)
    const characterId = Number(row.character_id) || null
    const previousRevision = Number(payload.previousRevision)
    const snapshot = Number.isFinite(previousRevision)
      ? snapshotByKey.get(`${characterId}:${previousRevision}`) || null
      : null
    const restored = restoredAt.get(characterId) || 0
    const createdAt = Number(row.created_at) || 0
    return {
      id: Number(row.id),
      created_at: createdAt,
      character_id: characterId,
      username: row.username || null,
      owner_id: row.owner_id ?? null,
      source: payload.source || null,
      reasons: Array.isArray(payload.reasons) ? payload.reasons : [],
      previous_revision: Number.isFinite(previousRevision) ? previousRevision : null,
      next_revision: Number.isFinite(Number(payload.nextRevision)) ? Number(payload.nextRevision) : null,
      durable_units: Number(payload.durableUnits) || 0,
      durable_value: Number(payload.durableValue) || 0,
      resource_units: Number(payload.resourceUnits) || 0,
      resource_value: Number(payload.resourceValue) || 0,
      coins_lost: Number(payload.coinsLost) || 0,
      charges_lost: Number(payload.chargesLost) || 0,
      distinct_items_lost: Number(payload.distinctItemsLost) || 0,
      items: Array.isArray(payload.items) ? payload.items : [],
      // The row to hand the Salvage panel. Null means the pre-loss state was
      // not preserved for this one and a neighbouring snapshot has to be picked
      // by hand.
      history_id: snapshot ? Number(snapshot.id) : null,
      snapshot_created_at: snapshot ? Number(snapshot.created_at) : null,
      // A restore for this character after the incident. Not proof it was THIS
      // incident that got fixed, but it is the difference between a queue that
      // drains and one that only grows.
      restored_since: restored > 0 && restored >= createdAt,
      character_incident_count: incidentCount.get(characterId) || 0,
      // The admin's verdict, carried on the row itself (the list query joins
      // it) so the filter and the LIMIT stay in SQL together.
      review_status: normaliseReviewStatus(row.review_status) || REVIEW_OPEN,
      review_note: clampReviewNote(row.review_note),
      reviewed_at: Number(row.reviewed_at) || null,
    }
  })
}

/** Totals across the rows in view, so the panel can answer "is this one player
 * or is it everywhere" without the admin adding up a list. */
export function summariseIncidents(incidents = []) {
  const characters = new Set()
  let durableUnits = 0
  let durableValue = 0
  let resourceValue = 0
  let unresolved = 0
  let dismissed = 0
  let confirmed = 0
  for (const incident of incidents) {
    if (incident.character_id) characters.add(incident.character_id)
    durableUnits += incident.durable_units
    durableValue += incident.durable_value
    resourceValue += incident.resource_value
    if (incident.review_status === REVIEW_DISMISSED) dismissed += 1
    else if (incident.review_status === REVIEW_CONFIRMED) confirmed += 1
    // A dismissed flag was never a loss, so it is not something left to fix.
    if (!incident.restored_since && incident.review_status !== REVIEW_DISMISSED) unresolved += 1
  }
  return {
    incidents: incidents.length,
    characters: characters.size,
    unresolved,
    dismissed,
    confirmed,
    durableUnits,
    durableValue,
    resourceValue,
  }
}
