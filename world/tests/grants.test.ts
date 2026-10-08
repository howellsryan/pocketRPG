import { describe, expect, it, vi } from 'vitest'
import { flushGrants, isEmptyPayload, type GrantIO, type GrantPayload } from '../server/grants'
import { applySlayerCreditToSave } from '../../functions/_lib/game/slayerCredit.js'

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
            // isCharacterInActiveMatch (flushGrants defence-in-depth) reads via
            // .first(); no seeded PvP match → null → treated as not in a match.
            first: async () => null,
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
    removeItemFromBank: (saveObject, itemId, quantity) => {
      const bank = (saveObject.bank ?? {}) as Record<string, { itemId: string; quantity: number }>
      const cur = bank[itemId]?.quantity ?? 0
      if (cur < quantity) throw new Error('INSUFFICIENT_SUPPLIES')
      if (cur === quantity) delete bank[itemId]
      else bank[itemId] = { itemId, quantity: cur - quantity }
    },
    bankQuantity: (saveObject, itemId) => {
      const bank = (saveObject.bank ?? {}) as Record<string, { quantity?: number }>
      return Math.floor(Number(bank[itemId]?.quantity) || 0)
    },
    applySlayerCreditToSave,
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

describe('flushGrants — slayer progress', () => {
  it('writes the advanced task back and adds the banked points as a delta', async () => {
    const { env } = makeDb()
    const io = makeIO({
      stats: {},
      settings: { slayerTask: { monsterId: 'green_dragon', monstersRemaining: 5 }, slayerPoints: 30, slayerTasksCompleted: 4 },
    })
    await flushGrants(env, who, payload({
      slayerTask: null,
      slayerCredit: { pointsEarned: 12, tasksCompleted: 1, masterCompletions: { vashka: 1 } },
      slayerTasksCompleted: 5,
    }), io)
    const { saveObject } = io.written[0] as { saveObject: any }
    expect(saveObject.settings.slayerTask).toBe(null)
    expect(saveObject.settings.slayerPoints).toBe(42)
    expect(saveObject.settings.slayerTasksCompleted).toBe(5)
    expect(saveObject.settings.slayerMasterTaskCompletions).toEqual({ vashka: 1 })
  })

  it('leaves the save\'s task alone when the session never touched it', async () => {
    const { env } = makeDb()
    const task = { monsterId: 'green_dragon', monstersRemaining: 5 }
    const io = makeIO({ stats: {}, settings: { slayerTask: task, slayerPoints: 30 } })
    await flushGrants(env, who, payload(), io)
    const { saveObject } = io.written[0] as { saveObject: any }
    expect(saveObject.settings.slayerTask).toEqual(task)
    expect(saveObject.settings.slayerPoints).toBe(30)
  })

  it('is not an empty payload when the only thing that moved is the task', () => {
    expect(isEmptyPayload(payload({ xpBySkill: {}, items: [], slayerTask: null }))).toBe(false)
  })
})

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

  it('removes consumed units from inventory and bank, clamped to what remains', async () => {
    const { env } = makeDb()
    const io = makeIO({
      stats: {},
      inventory: [{ itemId: 'trout', quantity: 2 }],
      bank: { bones: { itemId: 'bones', quantity: 3 } },
    })
    await flushGrants(env, who, payload({
      xpBySkill: {}, items: [],
      removeFromInventory: [{ itemId: 'trout', quantity: 5 }], // ate 5, save only has 2
      removeFromBank: [{ itemId: 'bones', quantity: 2 }],
      reason: 'timer',
    }), io)
    const { saveObject } = io.written[0] as { saveObject: any }
    expect(saveObject.inventory).toEqual([])
    expect(saveObject.bank.bones.quantity).toBe(1)
  })

  it('returns withdrawn-but-held units bank→inventory on disconnect', async () => {
    const { env } = makeDb()
    const io = makeIO({ stats: {}, inventory: [], bank: { trout: { itemId: 'trout', quantity: 4 } } })
    await flushGrants(env, who, payload({
      xpBySkill: {}, items: [],
      bankToInventory: [{ itemId: 'trout', quantity: 3 }],
      reason: 'disconnect',
    }), io)
    const { saveObject } = io.written[0] as { saveObject: any }
    expect(saveObject.bank.trout.quantity).toBe(1)
    expect(saveObject.inventory.filter((s: any) => s.itemId === 'trout')).toHaveLength(3)
  })

  it('grants mid-session bank deposits of minted units straight to the bank', async () => {
    const { env } = makeDb()
    const io = makeIO({ stats: {}, inventory: [] })
    await flushGrants(env, who, payload({
      xpBySkill: {}, items: [],
      mintedToBank: [{ itemId: 'tin_ore', quantity: 4 }],
      reason: 'timer',
    }), io)
    const { saveObject } = io.written[0] as { saveObject: any }
    expect(saveObject.bank.tin_ore.quantity).toBe(4)
  })

  it('snapshots re-geared equipment onto the save', async () => {
    const { env } = makeDb()
    const io = makeIO({ stats: {}, equipment: { weapon: { itemId: 'bronze_sword' } } })
    await flushGrants(env, who, payload({
      xpBySkill: {}, items: [],
      equipment: { weapon: { itemId: 'runeforged_scimitar' } },
      reason: 'timer',
    }), io)
    const { saveObject } = io.written[0] as { saveObject: any }
    expect(saveObject.equipment).toEqual({ weapon: { itemId: 'runeforged_scimitar' } })
  })

  it('an equipment-only payload is not empty', () => {
    expect(isEmptyPayload({ xpBySkill: {}, items: [], itemsTo: 'bank', moveToBank: [], equipment: {}, reason: 'timer' })).toBe(false)
    expect(isEmptyPayload({ xpBySkill: {}, items: [], itemsTo: 'bank', moveToBank: [], removeFromBank: [{ itemId: 'x', quantity: 1 }], reason: 'timer' })).toBe(false)
  })

  it('snapshots an in-world stance change onto the save settings', async () => {
    const { env } = makeDb()
    const io = makeIO({ stats: {}, settings: { combatStance: 'accurate' } })
    await flushGrants(env, who, payload({
      xpBySkill: {}, items: [],
      combatStance: 'aggressive',
      reason: 'timer',
    }), io)
    const { saveObject } = io.written[0] as { saveObject: any }
    expect(saveObject.settings.combatStance).toBe('aggressive')
  })

  it('preserves other settings fields when writing back combatStance', async () => {
    const { env } = makeDb()
    const io = makeIO({ stats: {}, settings: { completedQuests: ['crown_complications'] } })
    await flushGrants(env, who, payload({ xpBySkill: {}, items: [], combatStance: 'defensive', reason: 'timer' }), io)
    const { saveObject } = io.written[0] as { saveObject: any }
    expect(saveObject.settings.completedQuests).toEqual(['crown_complications'])
    expect(saveObject.settings.combatStance).toBe('defensive')
  })

  it('a combatStance-only payload is not empty', () => {
    expect(isEmptyPayload({ xpBySkill: {}, items: [], itemsTo: 'bank', moveToBank: [], combatStance: 'aggressive', reason: 'timer' })).toBe(false)
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

describe('committed grant audit failure',()=>{
  it('retains the grant receipt and does not retry already saved rewards',async()=>{
    const {env,calls}=makeDb()
    const io=makeIO({stats:{}},{auditLog:vi.fn(async()=>{throw new Error('audit unavailable')})})
    expect(await flushGrants(env,who,payload(),io)).toBe(true)
    expect(io.writeSave).toHaveBeenCalledTimes(1)
    expect(io.loadCharacterWithSave).toHaveBeenCalledTimes(1)
    expect(calls.some(call=>call.sql.includes('DELETE FROM world_grants'))).toBe(false)
  })
})
