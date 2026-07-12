import type { ZoneDef } from '../shared/zone'
import { validateZone } from '../shared/zone'

// D1-backed zone definitions. A stored row overrides the bundled zones/*.json
// of the same id; this is the persistence layer behind the world editor. The
// game runtime reads through loadStoredZone(); the editor API reads/writes the
// rest. All I/O lives here so the DO and the editor share one code path.

const MAX_REVISIONS = 20

export type StoredZoneMeta = {
  zoneId: string
  revision: number
  updatedAt: number
}

/** The stored def for a zone, or null when none is stored (caller falls back to
 * the bundled def). A stored-but-invalid row is treated as absent — a saved
 * world is always valid because saveZone validates before writing, so this only
 * guards against manual DB tampering. */
export async function loadStoredZone(db: D1Database, zoneId: string): Promise<ZoneDef | null> {
  const row = await db
    .prepare('SELECT def_json FROM world_zone_defs WHERE zone_id = ?')
    .bind(zoneId)
    .first<{ def_json: string }>()
  if (!row) return null
  try {
    const def = JSON.parse(row.def_json) as ZoneDef
    return validateZone(def).valid ? def : null
  } catch {
    return null
  }
}

export async function listStoredZones(db: D1Database): Promise<StoredZoneMeta[]> {
  const { results } = await db
    .prepare('SELECT zone_id, revision, updated_at FROM world_zone_defs ORDER BY zone_id')
    .all<{ zone_id: string; revision: number; updated_at: number }>()
  return (results ?? []).map((r) => ({ zoneId: r.zone_id, revision: r.revision, updatedAt: r.updated_at }))
}

/** Upserts a zone def (revision bumped), appends a revision-history row, and
 * trims history to the last MAX_REVISIONS. Returns the new revision number. */
export async function saveZone(db: D1Database, zoneId: string, def: ZoneDef): Promise<number> {
  const existing = await db
    .prepare('SELECT revision FROM world_zone_defs WHERE zone_id = ?')
    .bind(zoneId)
    .first<{ revision: number }>()
  const revision = (existing?.revision ?? 0) + 1
  const now = Date.now()
  const json = JSON.stringify(def)
  await db.batch([
    db
      .prepare(
        `INSERT INTO world_zone_defs (zone_id, def_json, revision, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(zone_id) DO UPDATE SET def_json = excluded.def_json, revision = excluded.revision, updated_at = excluded.updated_at`
      )
      .bind(zoneId, json, revision, now),
    db
      .prepare('INSERT INTO world_zone_revisions (zone_id, revision, def_json, created_at) VALUES (?, ?, ?, ?)')
      .bind(zoneId, revision, json, now),
    db
      .prepare(
        `DELETE FROM world_zone_revisions WHERE zone_id = ? AND id NOT IN
         (SELECT id FROM world_zone_revisions WHERE zone_id = ? ORDER BY revision DESC LIMIT ?)`
      )
      .bind(zoneId, zoneId, MAX_REVISIONS),
  ])
  return revision
}

/** Removes a stored zone def and its history. Returns whether a row existed. */
export async function deleteStoredZone(db: D1Database, zoneId: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM world_zone_defs WHERE zone_id = ?').bind(zoneId).run()
  await db.prepare('DELETE FROM world_zone_revisions WHERE zone_id = ?').bind(zoneId).run()
  return (res.meta?.changes ?? 0) > 0
}

export async function listRevisions(
  db: D1Database,
  zoneId: string
): Promise<{ revision: number; createdAt: number }[]> {
  const { results } = await db
    .prepare('SELECT revision, created_at FROM world_zone_revisions WHERE zone_id = ? ORDER BY revision DESC')
    .bind(zoneId)
    .all<{ revision: number; created_at: number }>()
  return (results ?? []).map((r) => ({ revision: r.revision, createdAt: r.created_at }))
}

export async function loadRevision(db: D1Database, zoneId: string, revision: number): Promise<ZoneDef | null> {
  const row = await db
    .prepare('SELECT def_json FROM world_zone_revisions WHERE zone_id = ? AND revision = ?')
    .bind(zoneId, revision)
    .first<{ def_json: string }>()
  if (!row) return null
  try {
    return JSON.parse(row.def_json) as ZoneDef
  } catch {
    return null
  }
}
