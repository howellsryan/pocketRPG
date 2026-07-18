// Item 5 (P0): world boss kills must record the same server-authoritative
// side-effects the main game's /api/actions/monster/complete does — collection
// log for uniques, boss kill count, audit. Regular monsters and unresolved
// owners record nothing.
import { describe, expect, it, vi } from 'vitest'
import { recordBossKill, isBossMonster, type BossKillIO } from '../server/bossKills'

type Call = { sql: string; args: unknown[] }

function makeDb(killCount = 1) {
  const inserts: Call[] = []
  const upserts: Call[] = []
  const batches: Call[][] = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const call: Call = { sql, args }
          return {
            run: async () => { (sql.includes('collection_log') ? inserts : upserts).push(call); return { meta: { changes: 1 } } },
            first: async () => { upserts.push(call); return { kill_count: killCount } },
          }
        },
      }
    },
    batch: async (stmts: { run: () => Promise<unknown> }[]) => {
      const captured: Call[] = []
      // Each stmt is the object returned by bind(); re-run to capture its call.
      for (const s of stmts) await (s as unknown as { run: () => Promise<unknown> }).run()
      batches.push(captured)
      return stmts.map(() => ({}))
    },
  }
  return { env: { DB: db as unknown as D1Database }, inserts, upserts, batches }
}

function spyIO(): BossKillIO & { audits: { eventType: string; payload: Record<string, unknown> }[] } {
  const audits: { eventType: string; payload: Record<string, unknown> }[] = []
  return { audits, auditLog: vi.fn(async (_env, eventType, payload) => { audits.push({ eventType, payload }) }) }
}

describe('recordBossKill', () => {
  it('records a collection-log unique, the kill count and an audit for a boss drop', async () => {
    const { env, inserts, upserts } = makeDb(3)
    const io = spyIO()
    await recordBossKill(env, {
      monsterId: 'warlord_grondar',
      owner: '42',
      loot: [{ itemId: 'big_bones', quantity: 1 }, { itemId: 'grondar_hilt', quantity: 1 }],
    }, io)

    // Exactly the unique goes to the collection log (common drops are skipped).
    expect(inserts).toHaveLength(1)
    expect(inserts[0].sql).toContain('collection_log')
    expect(inserts[0].args).toEqual([42, 'grondar_hilt', 'warlord_grondar', expect.any(Number)])
    // Kill count upsert ran for the boss.
    expect(upserts.some((c) => c.sql.includes('kill_counts') && c.args[0] === 42)).toBe(true)
    // Audit carries the resolved count + the unique.
    expect(io.audits).toHaveLength(1)
    expect(io.audits[0].eventType).toBe('world_boss_kill')
    expect(io.audits[0].payload).toMatchObject({ characterId: 42, monsterId: 'warlord_grondar', killCount: 3, collectionLog: ['grondar_hilt'] })
  })

  it('still increments the kill count + audits a boss kill with no unique in the drop', async () => {
    const { env, inserts, upserts } = makeDb(5)
    const io = spyIO()
    await recordBossKill(env, {
      monsterId: 'warlord_grondar',
      owner: '7',
      loot: [{ itemId: 'big_bones', quantity: 1 }, { itemId: 'coins', quantity: 20000 }],
    }, io)
    expect(inserts).toHaveLength(0) // no collection-log write
    expect(upserts.some((c) => c.sql.includes('kill_counts'))).toBe(true)
    expect(io.audits[0].payload).toMatchObject({ killCount: 5, collectionLog: [] })
  })

  it('records nothing for a non-boss monster', async () => {
    const { env, inserts, upserts } = makeDb()
    const io = spyIO()
    await recordBossKill(env, { monsterId: 'pasture_bull', owner: '42', loot: [{ itemId: 'cowhide', quantity: 1 }] }, io)
    expect(inserts).toHaveLength(0)
    expect(upserts).toHaveLength(0)
    expect(io.audits).toHaveLength(0)
    expect(isBossMonster('pasture_bull')).toBe(false)
    expect(isBossMonster('warlord_grondar')).toBe(true)
  })

  it('records nothing when the owner char id is unresolved', async () => {
    const { env, inserts, upserts } = makeDb()
    const io = spyIO()
    await recordBossKill(env, { monsterId: 'warlord_grondar', owner: 'not-a-number', loot: [{ itemId: 'grondar_hilt', quantity: 1 }] }, io)
    expect(inserts).toHaveLength(0)
    expect(upserts).toHaveLength(0)
    expect(io.audits).toHaveLength(0)
  })
})
