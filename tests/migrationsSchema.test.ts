// Schema-drift tripwire: every migrations/*.sql applies cleanly in order and
// produces the tables the endpoints rely on. If a migration is malformed or a
// table gets renamed out from under a handler, this fails before the endpoint
// tests do. See tests/helpers/d1 (real-schema D1 double).
import { describe, it, expect } from 'vitest'
import { migratedDb } from './helpers/d1'

describe('migrations apply to a real SQLite schema', () => {
  it('applies every migration and creates the core tables', () => {
    const db = migratedDb()
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map((r) => r.name),
    )
    for (const t of ['characters', 'saves', 'audit_events', 'purchase_grants', 'action_nonces', 'pvp_matches', 'oauth_identities']) {
      expect(tables.has(t), `missing table ${t}`).toBe(true)
    }
  })

  it('saves and characters carry the columns handlers read', () => {
    const db = migratedDb()
    const cols = (t: string) => new Set((db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((r) => r.name))
    const saves = cols('saves')
    for (const c of ['save_data', 'save_blob', 'save_revision', 'updated_at']) expect(saves.has(c), `saves.${c}`).toBe(true)
    const chars = cols('characters')
    for (const c of ['owner_id', 'is_ironman', 'credits', 'deleted_at', 'active_match_id']) expect(chars.has(c), `characters.${c}`).toBe(true)
  })
})
