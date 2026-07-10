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

class FullError extends Error {
  code = 'INVENTORY_FULL'
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
    addItemToInventory: (saveObject, itemId, quantity, { stackable }) => {
      const inv = ((saveObject.inventory ??= []) as { itemId: string; quantity: number }[])
      if (stackable) {
        const existing = inv.find((s) => s.itemId === itemId)
        if (existing) {
          existing.quantity += quantity
          return
        }
        if (inv.length >= 28) throw new FullError()
        inv.push({ itemId, quantity })
        return
      }
      if (inv.length + quantity > 28) throw new FullError()
      for (let i = 0; i < quantity; i++) inv.push({ itemId, quantity: 1 })
    },
    removeItemFromInventory: (saveObject, itemId, quantity) => {
      const inv = (saveObject.inventory ?? []) as { itemId: string; quantity: number }[]
      let remaining = quantity
      for (let i = inv.length - 1; i >= 0 && remaining > 0; i--) {
        if (inv[i].itemId !== itemId) continue
        const take = Math.min(inv[i].quantity, remaining)
        inv[i].quantity -= take
        remaining -= take
        if (inv[i].quantity === 0) inv.splice(i, 1)
      }
      if (remaining > 0) throw new Error('INSUFFICIENT_SUPPLIES')
    },
    auditLog: vi.fn(async (_env, _type, payload: Record<string, unknown>) => {
      audits.push(payload)
    }),
    ...overrides,
  }
}

const who = { charId: 42, identityId: 'id-1', sessionId: 'sess-1', flushSeq: 1 }

function payload(overrides: Partial<GrantPayload> = {}): GrantPayload {
  return {
    xpBySkill: { mining: 85 },
    items: [{ itemId: 'tin_ore', quantity: 5 }],
    itemsTo: 'bank',
    moveToBank: [],
    reason: 'deposit',
    ...overrides,
  }
}

describe('flushGrants', () => {
  it('applies xp (level re-derived) and banks minted items, then audits', async () => {
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

  it('lands minted items in the inventory on a disconnect flush', async () => {
    const { env } = makeDb()
    const io = makeIO({ stats: {}, inventory: [{ itemId: 'tin_ore', quantity: 1 }] })
    await flushGrants(env, who, payload({ items: [{ itemId: 'tin_ore', quantity: 5 }], itemsTo: 'inventory', reason: 'disconnect' }), io)
    const { saveObject } = io.written[0] as { saveObject: any }
    // tin ore is non-stackable: 1 seeded slot + 5 new single-unit slots
    expect(saveObject.inventory).toHaveLength(6)
    expect(saveObject.bank ?? {}).toEqual({})
  })

  it('spills to the bank when the inventory cannot hold everything', async () => {
    const { env } = makeDb()
    const fullInv = Array.from({ length: 26 }, () => ({ itemId: 'logs', quantity: 1 }))
    const io = makeIO({ stats: {}, inventory: fullInv })
    await flushGrants(env, who, payload({ items: [{ itemId: 'tin_ore', quantity: 5 }], itemsTo: 'inventory', reason: 'disconnect' }), io)
    const { saveObject } = io.written[0] as { saveObject: any }
    expect(saveObject.inventory).toHaveLength(28)
    expect(saveObject.bank.tin_ore.quantity).toBe(3)
  })

  it('moves save-backed units from inventory to bank on deposit', async () => {
    const { env } = makeDb()
    const io = makeIO({ stats: {}, inventory: [
      { itemId: 'tin_ore', quantity: 1 },
      { itemId: 'tin_ore', quantity: 1 },
      { itemId: 'logs', quantity: 1 },
    ] })
    await flushGrants(env, who, payload({
      items: [{ itemId: 'tin_ore', quantity: 3 }],
      itemsTo: 'bank',
      moveToBank: [{ itemId: 'tin_ore', quantity: 2 }],
    }), io)
    const { saveObject } = io.written[0] as { saveObject: any }
    expect(saveObject.inventory).toEqual([{ itemId: 'logs', quantity: 1 }])
    expect(saveObject.bank.tin_ore.quantity).toBe(5)
  })

  it('moves only what the save inventory still holds', async () => {
    const { env } = makeDb()
    // Session thinks 5 are save-backed but the main game consumed 3 meanwhile.
    const io = makeIO({ stats: {}, inventory: [{ itemId: 'tin_ore', quantity: 2 }] })
    await flushGrants(env, who, payload({ items: [], moveToBank: [{ itemId: 'tin_ore', quantity: 5 }] }), io)
    const { saveObject } = io.written[0] as { saveObject: any }
    expect(saveObject.inventory).toEqual([])
    expect(saveObject.bank.tin_ore.quantity).toBe(2)
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
      writeSave: vi.fn(async (env2, charId, saveObject: Record<string, unknown>, expectedRevision: number) => {
        if (failures-- > 0) throw Object.assign(new Error('conflict'), { code: 'SAVE_REVISION_CONFLICT' })
        return base.writeSave(env2, charId, saveObject, expectedRevision)
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
    const empty: GrantPayload = { xpBySkill: { mining: 0 }, items: [], itemsTo: 'bank', moveToBank: [], reason: 'timer' }
    expect(isEmptyPayload(empty)).toBe(true)
    expect(await flushGrants(env, who, empty, io)).toBe(true)
    expect(calls).toHaveLength(0)
  })
})
