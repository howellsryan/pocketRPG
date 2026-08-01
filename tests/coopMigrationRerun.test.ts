// The co-op migration has to survive being run twice.
//
// The bug this guards: D1 aborts a batch at the first failing statement and
// reports nothing about the rest. A re-run whose ALTER threw `duplicate column
// name` silently skipped every statement after it, and the missing column only
// surfaced as /api/save 500ing on `no such column: m.last_seen_at` — every save
// for every player, not just the co-op ones.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { migratedDb } from './helpers/d1'
import { isCoopSessionLive } from '../functions/_lib/game/coopBoss.js'
import { FakeD1 } from './helpers/d1'

const FILE = join(__dirname, '..', 'migrations', '0031_coop_boss_sessions.sql')
const sql = readFileSync(FILE, 'utf8')

describe('the co-op migration', () => {
  it('puts the one statement that cannot be re-run first', () => {
    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--') && line.trim() !== '')
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    // Everything after it must be re-runnable, so a database that already has
    // the column loses nothing by the abort.
    expect(statements[0]).toMatch(/^ALTER TABLE characters ADD COLUMN active_coop_session_id/)
    expect(statements.slice(1).filter((s) => /^ALTER TABLE/i.test(s))).toEqual([])
  })

  it('re-applies cleanly from the statement after the ALTER', () => {
    const db = migratedDb()
    const withoutAlter = sql.slice(sql.indexOf(';', sql.indexOf('ALTER TABLE characters')) + 1)
    expect(() => db.exec(withoutAlter)).not.toThrow()
  })

  it('leaves the save-lock query working after that re-run', async () => {
    const db = migratedDb()
    db.exec(sql.slice(sql.indexOf(';', sql.indexOf('ALTER TABLE characters')) + 1))
    db.prepare(
      `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
       VALUES (1, 1, 'c1', 0, 0, 0, 0, 0, 0, 700, 126, 0, 0)`,
    ).run()
    // The exact read /api/save makes on every single write.
    await expect(isCoopSessionLive({ DB: new FakeD1(db) } as never, 1)).resolves.toBe(false)
  })
})

const PER_MEMBER = join(__dirname, '..', 'migrations', '0032_coop_kill_settlement_per_member.sql')
const perMemberSql = readFileSync(PER_MEMBER, 'utf8')

describe('the per-member settlement migration', () => {
  it('re-applies cleanly', () => {
    const db = migratedDb()
    expect(() => db.exec(perMemberSql)).not.toThrow()
  })

  it('keys the ledger on the character, so one kill can pay several members', () => {
    const db = migratedDb()
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'coop_kill_settlements'").get() as any
    expect(row.sql).toMatch(/PRIMARY KEY \(session_id, kill_seq, character_id\)/)

    const insert = (characterId: number) => db.prepare(
      "INSERT INTO coop_kill_settlements (session_id, kill_seq, character_id, boss_id, settled_at) VALUES (1, 1, ?, 'corporeal_horror', 0)",
    ).run(characterId)
    insert(7)
    insert(8)
    // ...but the same member still cannot be paid twice for the same kill.
    expect(() => insert(7)).toThrow()
  })

  it('has to come after 0031, which recreates the table on the old key', () => {
    // 0031 is re-runnable by design and DROPs this table; running it again on a
    // live database would silently put the single-winner key back.
    expect(PER_MEMBER > FILE).toBe(true)
  })
})
