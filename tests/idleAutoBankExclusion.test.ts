import { describe, expect, it } from 'vitest'
import { simulateIdleSkilling } from '../src/engine/idleEngine.js'
import { getLevelFromXP } from '../src/engine/experience.js'

function xpForLevel(target: number) {
  let xp = 0
  while (getLevelFromXP(xp) < target) xp += 100
  return xp
}

const MINE_IRON_ACTION = { id: 'iron', name: 'Mine iron ore', level: 15, ticks: 5, xp: 35, product: 'iron_ore' }
const ITEMS_DATA = { iron_ore: { stackable: true } } as any

describe('idle auto-bank exclusion (simulateIdleSkilling gathering path)', () => {
  it('never banks an excluded item type, even when it fills the whole inventory', () => {
    const task: any = { type: 'skill', skill: 'mining', action: MINE_IRON_ACTION }
    const stats: any = { mining: { xp: xpForLevel(15) }, agility: { xp: xpForLevel(99) } }
    const inventory: any = Array.from({ length: 28 }, () => ({ itemId: 'junk', quantity: 1 }))

    const sim = simulateIdleSkilling(
      task, 60_000, {} as any, {} as any, stats, ITEMS_DATA, inventory,
      { autoBankExcludedItemIds: new Set(['junk']) }
    )

    expect(sim).toBeTruthy()
    // Nothing can be banked (the whole inventory is excluded), so mining never
    // gets room to start — matches the pre-existing "full and can't bank" path.
    expect(sim!.actions).toBe(0)
    expect(sim!.itemsBanked.junk).toBeUndefined()
    expect(sim!.stoppedReason).toBe('inventory_full')
    expect(sim!.finalInventory.every((s: any) => s?.itemId === 'junk')).toBe(true)
  })

  it('banks every non-excluded item on a full-inventory bank trip but leaves excluded items in place', () => {
    const task: any = { type: 'skill', skill: 'mining', action: MINE_IRON_ACTION }
    const stats: any = { mining: { xp: xpForLevel(15) }, agility: { xp: xpForLevel(99) } }
    const inventory: any = [
      ...Array.from({ length: 14 }, () => ({ itemId: 'junk', quantity: 1 })),
      ...Array.from({ length: 14 }, () => ({ itemId: 'filler', quantity: 1 })),
    ]

    const sim = simulateIdleSkilling(
      task, 60_000, {} as any, {} as any, stats, ITEMS_DATA, inventory,
      { autoBankExcludedItemIds: new Set(['junk']) }
    )

    expect(sim).toBeTruthy()
    expect(sim!.actions).toBeGreaterThan(0)
    expect(sim!.itemsBanked.filler).toBe(14)
    expect(sim!.itemsBanked.junk).toBeUndefined()
    const junkSlots = sim!.finalInventory.filter((s: any) => s?.itemId === 'junk').length
    expect(junkSlots).toBe(14)
    expect(sim!.finalInventory.some((s: any) => s?.itemId === 'filler')).toBe(false)
  })
})
