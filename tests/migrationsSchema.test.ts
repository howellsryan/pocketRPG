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
    for (const t of ['characters', 'saves', 'audit_events', 'purchase_grants', 'action_nonces', 'oauth_identities']) {
      expect(tables.has(t), `missing table ${t}`).toBe(true)
    }
  })

  it('saves and characters carry the columns handlers read', () => {
    const db = migratedDb()
    const cols = (t: string) => new Set((db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((r) => r.name))
    const saves = cols('saves')
    for (const c of ['save_data', 'save_blob', 'save_revision', 'updated_at']) expect(saves.has(c), `saves.${c}`).toBe(true)
    const chars = cols('characters')
    for (const c of ['owner_id', 'is_ironman', 'credits', 'deleted_at']) expect(chars.has(c), `characters.${c}`).toBe(true)
  })

  // The duel stack the Wilderness replaced. Its tables carried real save-lock
  // authority, so a migration that resurrected one would make every endpoint
  // that used to read it start refusing writes again.
  it('leaves no trace of the retired duel schema', () => {
    const db = migratedDb()
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map((r) => r.name),
    )
    for (const t of ['pvp_matches', 'pvp_waiting_room', 'pvp_invitations', 'pvp_intents']) {
      expect(tables.has(t), `duel table ${t} is back`).toBe(false)
    }
    const chars = new Set((db.prepare('PRAGMA table_info(characters)').all() as any[]).map((r) => r.name))
    expect(chars.has('active_match_id'), 'characters.active_match_id is back').toBe(false)
  })
})
