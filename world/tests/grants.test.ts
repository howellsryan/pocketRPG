import { describe, expect, it, vi } from 'vitest'
import { flushGrants, isEmptyPayload, type GrantIO, type GrantPayload } from '../server/grants'

const MAX_XP = 200_000_000

type DbCall = { sql: string; args: unknown[] }

function makeDb(insertChanges = 1) {
  const calls: DbCall[] = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            run: async () => {
              calls.push({ sql, args })
              const changes = sql.includes('INSERT INTO world_grants') ? insertChanges : 1
              return { meta: { changes } }
            },
          }
        },
      }
    },
  }
  return { env: { DB: db as unknown as D1Database }, calls }
}

function makeIO(save: Record<string, unknown>, overrides: Partial<GrantIO> = {}): GrantIO & {
  written: Record<string, unknown>[]
  audits: Record<string, unknown>[]
} {
  const written: Record<string, unknown>[] = []
  const audits: Record<string, unknown>[] = []
  return {
    written,
    audits,
    loadCharacterWithSave: vi.fn(async () => ({ saveObject: structuredClone(save), saveRevision: 7 })),
    writeSave: vi.fn(async (_env, _charId, saveObject: Record<string, unknown>, expectedRevision: number) => {
      written.push({ saveObject, expectedRevision })
    }),
    addItemToBank: (saveObject, itemId, quantity) => {
      const bank = ((saveObject.bank ??= {}) as Record<string, { itemId: string; quantity: number }>)
      const cur = bank[itemId]?.quantity ?? 0
      bank[itemId] = { itemId, quantity: cur + quantity }
    },
    auditLog: vi.fn(async (_env, _type, payload: Record<string, unknown>) => {
      audits.push(payload)
    }),
    ...overrides,
  }
}

const who = { charId: 42, identityId: 'id-1', sessionId: 'sess-1', flushSeq: 1 }

function payload(overrides: Partial<GrantPayload> = {}): GrantPayload {
  return { xpBySkill: { mining: 85 }, items: [{ itemId: 'tin_ore', quantity: 5 }], reason: 'deposit', ...overrides }
}

describe('flushGrants', () => {
  it('applies xp (level re-derived) and banks items, then audits', async () => {
    const { env, calls } = makeDb()
    const io = makeIO({ stats: { mining: { xp: 0, level: 1 } } })
    const ok = await flushGrants(env, who, payload(), io)
    expect(ok).toBe(true)

    const { saveObject, expectedRevision } = io.written[0] as { saveObject: any; expectedRevision: number }
    expect(expectedRevision).toBe(7)
    expect(saveObject.stats.mining).toEqual({ xp: 85, level: 2 })
    expect(saveObject.bank.tin_ore).toEqual({ itemId: 'tin_ore', quantity: 5 })
    expect(io.audits[0]).toMatchObject({ characterId: 42, reason: 'deposit', idempotencyKey: 'wg:42:sess-1:1' })
    expect(calls.some((c) => c.sql.includes('INSERT INTO world_grants'))).toBe(true)
  })

  it('clamps xp at the 200M cap', async () => {
    const { env } = makeDb()
    const io = makeIO({ stats: { mining: { xp: MAX_XP - 10, level: 99 } } })
    await flushGrants(env, who, payload(), io)
    const { saveObject } = io.written[0] as { saveObject: any }
    expect(saveObject.stats.mining.xp).toBe(MAX_XP)
  })

  it('creates missing skill entries instead of dropping the xp', async () => {
    const { env } = makeDb()
    const io = makeIO({ stats: {} })
    await flushGrants(env, who, payload(), io)
    const { saveObject } = io.written[0] as { saveObject: any }
    expect(saveObject.stats.mining).toEqual({ xp: 85, level: 2 })
  })

  it('is idempotent: replayed key applies nothing and reports success', async () => {
    const { env } = makeDb(0)
    const io = makeIO({ stats: {} })
    const ok = await flushGrants(env, who, payload(), io)
    expect(ok).toBe(true)
    expect(io.loadCharacterWithSave).not.toHaveBeenCalled()
    expect(io.written).toHaveLength(0)
  })

  it('retries on revision conflict and succeeds', async () => {
    const { env } = makeDb()
    const base = makeIO({ stats: {} })
    let failures = 2
    const io = makeIO({ stats: {} }, {
      writeSave: vi.fn(async (env, charId, saveObject: Record<string, unknown>, expectedRevision: number) => {
        if (failures-- > 0) throw Object.assign(new Error('conflict'), { code: 'SAVE_REVISION_CONFLICT' })
        return base.writeSave(env, charId, saveObject, expectedRevision)
      }),
    })
    const ok = await flushGrants(env, who, payload(), io)
    expect(ok).toBe(true)
    expect(io.loadCharacterWithSave).toHaveBeenCalledTimes(3)
  })

  it('gives up after 3 conflicts, deletes the idempotency row, returns false', async () => {
    const { env, calls } = makeDb()
    const io = makeIO({ stats: {} }, {
      writeSave: vi.fn(async () => {
        throw Object.assign(new Error('conflict'), { code: 'SAVE_REVISION_CONFLICT' })
      }),
    })
    const ok = await flushGrants(env, who, payload(), io)
    expect(ok).toBe(false)
    expect(io.loadCharacterWithSave).toHaveBeenCalledTimes(3)
    expect(calls.some((c) => c.sql.includes('DELETE FROM world_grants'))).toBe(true)
  })

  it('short-circuits an empty payload without touching the DB', async () => {
    const { env, calls } = makeDb()
    const io = makeIO({ stats: {} })
    const empty: GrantPayload = { xpBySkill: { mining: 0 }, items: [], reason: 'timer' }
    expect(isEmptyPayload(empty)).toBe(true)
    expect(await flushGrants(env, who, empty, io)).toBe(true)
    expect(calls).toHaveLength(0)
  })
})
