// Item 5 (P0): world boss kills must record the same server-authoritative
// side-effects the main game's /api/actions/monster/complete does — collection
// log for uniques and an audit row. Regular monsters and unresolved owners
// record nothing here. The KILL COUNT is no longer part of this: every monster
// earns one, so it is tallied on the session and flushed by recordKillCounts.
import { describe, expect, it, vi } from 'vitest'
import { recordBossKill, recordKillCounts, isBossMonster, uniqueDropsFrom, dropBroadcastsFrom, type BossKillIO } from '../server/bossKills'

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
    // The kill count is the flush's job now, not this path's.
    expect(upserts.some((c) => c.sql.includes('kill_counts'))).toBe(false)
    // Audit carries the unique.
    expect(io.audits).toHaveLength(1)
    expect(io.audits[0].eventType).toBe('world_boss_kill')
    expect(io.audits[0].payload).toMatchObject({ characterId: 42, monsterId: 'warlord_grondar', collectionLog: ['grondar_hilt'] })
  })

  it('audits a boss kill with no unique in the drop', async () => {
    const { env, inserts, upserts } = makeDb(5)
    const io = spyIO()
    await recordBossKill(env, {
      monsterId: 'warlord_grondar',
      owner: '7',
      loot: [{ itemId: 'big_bones', quantity: 1 }, { itemId: 'coins', quantity: 20000 }],
    }, io)
    expect(inserts).toHaveLength(0) // no collection-log write
    expect(upserts).toHaveLength(0)
    expect(io.audits[0].payload).toMatchObject({ collectionLog: [] })
  })

  it('fills a collection-log slot for a NON-boss monster that owns one', async () => {
    // The bug: gated on `boss`, so a Black Dragon's visage — a logged unique
    // whose killer is not a boss — could never fill its slot in the world,
    // while the same kill solo does.
    const { env, inserts } = makeDb()
    const io = spyIO()
    await recordBossKill(env, {
      monsterId: 'black_dragon',
      owner: '42',
      loot: [{ itemId: 'dragon_bones', quantity: 1 }, { itemId: 'dragon_visage', quantity: 1 }],
    }, io)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].args).toEqual([42, 'dragon_visage', 'black_dragon', expect.any(Number)])
    expect(io.audits[0].payload).toMatchObject({ monsterId: 'black_dragon', boss: false, collectionLog: ['dragon_visage'] })
  })

  it('records nothing for an ordinary kill that dropped nothing logged', async () => {
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

// Every world monster earns a kill count, not just bosses: the world resolves
// its own combat, so this is a server-authoritative count in the table the boss
// entry gates read. Batched, because a per-kill round trip is not affordable.
describe('recordKillCounts', () => {
  it('upserts one row per monster carrying that monster\'s whole tally', async () => {
    const { env, upserts } = makeDb()
    await recordKillCounts(env, 42, { green_dragon: 7, pasture_bull: 2 }, 1000)
    expect(upserts).toHaveLength(2)
    expect(upserts.every((c) => c.sql.includes('kill_counts'))).toBe(true)
    expect(upserts.map((c) => c.args)).toEqual([
      [42, 'green_dragon', 7, 1000],
      [42, 'pasture_bull', 2, 1000],
    ])
  })

  it('adds the tally to the existing count rather than overwriting it', async () => {
    const { env, upserts } = makeDb()
    await recordKillCounts(env, 42, { green_dragon: 3 })
    expect(upserts[0].sql).toContain('kill_count = kill_count + excluded.kill_count')
  })

  it('writes nothing for an empty tally, a zero count or an unresolved character', async () => {
    const { env, upserts } = makeDb()
    await recordKillCounts(env, 42, {})
    await recordKillCounts(env, 42, { green_dragon: 0 })
    await recordKillCounts(env, 0, { green_dragon: 5 })
    expect(upserts).toHaveLength(0)
  })
})

// Item 11 (P1): the unique-drop broadcast reuses this filter, so it must agree
// exactly with what recordBossKill writes to the collection log.
describe('uniqueDropsFrom', () => {
  it('keeps only collection-log-eligible items, deduped', () => {
    const ids = uniqueDropsFrom('warlord_grondar', [
      { itemId: 'grondar_hilt', quantity: 1 },
      { itemId: 'grondar_hilt', quantity: 1 },
      { itemId: 'big_bones', quantity: 1 },
      { itemId: 'coins', quantity: 20000 },
    ])
    expect(ids).toEqual(['grondar_hilt'])
  })

  it('returns an empty list when the drop has no unique', () => {
    expect(uniqueDropsFrom('warlord_grondar', [{ itemId: 'big_bones', quantity: 1 }])).toEqual([])
  })
})

// The zone-wide feed answers two different questions with one event: "a boss
// dropped a collection-log unique" and "somebody just pulled something worth a
// fortune". The second is the purple-loot-modal threshold, and it is not a boss
// privilege.
describe('dropBroadcastsFrom', () => {
  it('announces a boss unique that is not itself legendary', () => {
    const items = { grondar_hilt: { shopValue: 500 }, big_bones: { shopValue: 20 } }
    expect(dropBroadcastsFrom('warlord_grondar', [
      { itemId: 'grondar_hilt', quantity: 1 },
      { itemId: 'big_bones', quantity: 1 },
    ], items)).toEqual([{ itemId: 'grondar_hilt', epic: false }])
  })

  it('announces a legendary drop from an ordinary monster too', () => {
    const items = { onyx: { shopValue: 2_600_000 }, bones: { shopValue: 29 } }
    expect(dropBroadcastsFrom('goblin', [
      { itemId: 'bones', quantity: 1 },
      { itemId: 'onyx', quantity: 1 },
    ], items)).toEqual([{ itemId: 'onyx', epic: true }])
  })

  it('announces a boss unique that is ALSO legendary exactly once, as epic', () => {
    const items = { grondar_hilt: { shopValue: 18_092_500 } }
    expect(dropBroadcastsFrom('warlord_grondar', [
      { itemId: 'grondar_hilt', quantity: 1 },
    ], items)).toEqual([{ itemId: 'grondar_hilt', epic: true }])
  })

  it('stays silent for an ordinary monster dropping ordinary loot', () => {
    const items = { bones: { shopValue: 29 }, coins: { shopValue: 1 } }
    expect(dropBroadcastsFrom('goblin', [
      { itemId: 'bones', quantity: 1 },
      { itemId: 'coins', quantity: 4_000_000 },
    ], items)).toEqual([])
  })
})
