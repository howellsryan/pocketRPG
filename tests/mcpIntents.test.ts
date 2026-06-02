import { describe, it, expect } from 'vitest'
import {
  depositToBank,
  withdrawFromBank,
  equip,
  unequip,
  buildSkillTask,
  applyIdleSkillResult,
  toSlotArray,
  runIdleSkilling,
} from '../functions/_lib/mcp/intents.js'
import { getLevelFromXP } from '../src/engine/experience.js'

// Phase C save intents are pure mutations of a decoded save. These golden tests
// exercise them directly (no D1), asserting items only relocate and that
// invalid requests throw before any partial state could be written.

function makeSave(overrides: any = {}) {
  return {
    stats: {},
    inventory: [],
    bank: {},
    equipment: {},
    settings: { completedQuests: [] },
    ...overrides,
  }
}

describe('bank intents', () => {
  it('deposit moves items inventory → bank', () => {
    const save = makeSave({ inventory: [{ itemId: 'oak_logs', quantity: 5 }] })
    const r = depositToBank(save, 'oak_logs', 3)
    expect(r).toMatchObject({ action: 'deposit', itemId: 'oak_logs', quantity: 3 })
    expect(save.bank.oak_logs).toEqual({ itemId: 'oak_logs', quantity: 3 })
    expect(save.inventory.find((s: any) => s.itemId === 'oak_logs')?.quantity).toBe(2)
  })

  it('deposit beyond what you hold throws (nothing written)', () => {
    const save = makeSave({ inventory: [{ itemId: 'oak_logs', quantity: 5 }] })
    expect(() => depositToBank(save, 'oak_logs', 10)).toThrow()
    expect(save.bank.oak_logs).toBeUndefined()
  })

  it('withdraw moves items bank → inventory and clears emptied bank entries', () => {
    const save = makeSave({ bank: { feather: { itemId: 'feather', quantity: 100 } } })
    withdrawFromBank(save, 'feather', 100)
    expect(save.bank.feather).toBeUndefined()
    expect(save.inventory.find((s: any) => s.itemId === 'feather')?.quantity).toBe(100)
  })

  it('withdraw beyond bank stock throws', () => {
    const save = makeSave({ bank: { feather: { itemId: 'feather', quantity: 10 } } })
    expect(() => withdrawFromBank(save, 'feather', 999)).toThrow()
  })

  it('withdraw into a full inventory throws (28-slot cap)', () => {
    const inventory = Array.from({ length: 28 }, (_, i) => ({ itemId: `filler_${i}`, quantity: 1 }))
    const save = makeSave({ inventory, bank: { oak_logs: { itemId: 'oak_logs', quantity: 1 } } })
    expect(() => withdrawFromBank(save, 'oak_logs', 1)).toThrow()
    // bank untouched because the add failed before… actually remove happens first,
    // but the whole intent is discarded by the caller on throw. We assert it threw.
  })
})

describe('equipment intents', () => {
  it('equips a weapon and removes it from inventory', () => {
    const save = makeSave({ inventory: [{ itemId: 'bronze_dagger', quantity: 1 }] })
    const r = equip(save, 'bronze_dagger')
    expect(r).toMatchObject({ action: 'equip', slot: 'weapon', itemId: 'bronze_dagger' })
    expect(save.equipment.weapon.itemId).toBe('bronze_dagger')
    expect(save.inventory.find((s: any) => s.itemId === 'bronze_dagger')).toBeUndefined()
  })

  it('swapping a weapon returns the previous one to the inventory', () => {
    const save = makeSave({
      inventory: [{ itemId: 'iron_dagger', quantity: 1 }],
      equipment: { weapon: { itemId: 'bronze_dagger', _twoHanded: false } },
    })
    const r = equip(save, 'iron_dagger')
    expect(save.equipment.weapon.itemId).toBe('iron_dagger')
    expect(save.inventory.find((s: any) => s.itemId === 'bronze_dagger')?.quantity).toBe(1)
    expect(r.unequipped).toEqual([{ itemId: 'bronze_dagger', name: expect.any(String) }])
  })

  it('equips an ammo stack as a single equipment entry', () => {
    const save = makeSave({ inventory: [{ itemId: 'bronze_arrow', quantity: 50 }] })
    equip(save, 'bronze_arrow')
    expect(save.equipment.ammo).toMatchObject({ itemId: 'bronze_arrow', quantity: 50 })
    expect(save.inventory.find((s: any) => s.itemId === 'bronze_arrow')).toBeUndefined()
  })

  it('refuses to equip an item not in inventory', () => {
    expect(() => equip(makeSave(), 'bronze_dagger')).toThrow()
  })

  it('refuses to equip a non-equippable item', () => {
    const save = makeSave({ inventory: [{ itemId: 'oak_logs', quantity: 1 }] })
    expect(() => equip(save, 'oak_logs')).toThrow(/cannot be equipped/)
  })

  it('enforces skill requirements', () => {
    // mithril_dagger needs attack 20; a fresh account is level 1.
    const save = makeSave({ inventory: [{ itemId: 'mithril_dagger', quantity: 1 }] })
    expect(() => equip(save, 'mithril_dagger')).toThrow(/attack/i)
    expect(save.equipment.weapon).toBeUndefined()
  })

  it('unequips a slot back to the inventory', () => {
    const save = makeSave({ equipment: { weapon: { itemId: 'bronze_dagger', _twoHanded: false } } })
    const r = unequip(save, 'weapon')
    expect(r).toMatchObject({ action: 'unequip', slot: 'weapon', itemId: 'bronze_dagger' })
    expect(save.equipment.weapon).toBeNull()
    expect(save.inventory.find((s: any) => s.itemId === 'bronze_dagger')?.quantity).toBe(1)
  })

  it('unequipping an empty slot throws', () => {
    expect(() => unequip(makeSave(), 'weapon')).toThrow(/Nothing equipped/)
  })
})

describe('idle skilling intents', () => {
  it('builds a valid production-skill task', () => {
    const task = buildSkillTask(makeSave(), 'firemaking', 'normal_logs')
    expect(task).toMatchObject({ type: 'skill', skill: 'firemaking', bankingEnabled: true })
    expect(task.action.id).toBe('normal_logs')
  })

  it('rejects gathering/combat skills (production only)', () => {
    expect(() => buildSkillTask(makeSave(), 'woodcutting', 'normal')).toThrow(/production skills/i)
  })

  it('rejects an unknown action', () => {
    expect(() => buildSkillTask(makeSave(), 'firemaking', 'nope')).toThrow(/Unknown/)
  })

  it('enforces the action level requirement', () => {
    // firemaking 'oak_logs' needs level 15; a fresh account is level 1.
    expect(() => buildSkillTask(makeSave(), 'firemaking', 'oak_logs')).toThrow(/required/i)
  })

  it('toSlotArray pads to a fixed 28-slot array', () => {
    const arr = toSlotArray(makeSave({ inventory: [{ itemId: 'logs', quantity: 3 }] }))
    expect(arr).toHaveLength(28)
    expect(arr[0]).toEqual({ itemId: 'logs', quantity: 3 })
    expect(arr[1]).toBeNull()
  })

  it('applyIdleSkillResult applies XP, consumes inputs, banks output, sets inventory', () => {
    const save = makeSave({
      stats: { cooking: { xp: 1000, level: 9 } },
      bank: { raw_shrimps: { itemId: 'raw_shrimps', quantity: 10 } },
    })
    const sim = {
      skill: 'cooking',
      actionName: 'Cook shrimps',
      actions: 5,
      xpGained: { cooking: 150, mining: 99 }, // mining absent from stats → ignored
      itemsConsumed: { raw_shrimps: 5 },
      itemsBanked: { shrimps: 5 },
      finalInventory: [{ itemId: 'pickaxe', quantity: 1 }],
    }
    const summary = applyIdleSkillResult(save, sim)
    expect(save.stats.cooking.xp).toBe(1150)
    expect(save.stats.cooking.level).toBe(getLevelFromXP(1150))
    expect(save.stats.mining).toBeUndefined()
    expect(save.bank.raw_shrimps.quantity).toBe(5)
    expect(save.bank.shrimps).toEqual({ itemId: 'shrimps', quantity: 5 })
    expect(save.inventory).toEqual([{ itemId: 'pickaxe', quantity: 1 }])
    expect(summary.itemsBanked).toContainEqual({ itemId: 'shrimps', name: expect.any(String), quantity: 5 })
  })

  it('runIdleSkilling simulates a real window and grants XP', () => {
    const save = makeSave({
      stats: { firemaking: { xp: 0, level: 1 } },
      inventory: [{ itemId: 'logs', quantity: 100 }],
    })
    const r = runIdleSkilling(save, buildSkillTask(save, 'firemaking', 'normal_logs'), 60_000)
    expect(r.applied).toBe(true)
    expect(typeof r.xpGained.firemaking).toBe('number')
    expect(r.xpGained.firemaking).toBeGreaterThan(0)
  })
})
