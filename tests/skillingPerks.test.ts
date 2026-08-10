import { describe, expect, it } from 'vitest'
import items from '../src/data/items.json'
import skills from '../src/data/skills.json'
import monsters from '../src/data/monsters.json'
import collectionLog from '../src/data/collectionLog.json'
import { getSkillYieldMultiplier } from '../src/engine/skillingPerks.js'
import { simulateIdleSkilling } from '../src/engine/idleEngine.js'
import { monsterHasLoggedDrop } from '../src/engine/collectionLog.js'

const EQUIPPED = { gloves: { itemId: 'bracelet_of_runecrafting' } }

describe('getSkillYieldMultiplier', () => {
  it('doubles runecrafting output when the bracelet is equipped', () => {
    expect(getSkillYieldMultiplier('runecraft', 'craft_air_rune', EQUIPPED, items as any)).toBe(2)
  })

  it('doubles only the rune_essence mining action, not other ores', () => {
    expect(getSkillYieldMultiplier('mining', 'rune_essence', EQUIPPED, items as any)).toBe(2)
    expect(getSkillYieldMultiplier('mining', 'iron', EQUIPPED, items as any)).toBe(1)
  })

  it('does nothing when nothing is equipped', () => {
    expect(getSkillYieldMultiplier('runecraft', 'craft_air_rune', {}, items as any)).toBe(1)
    expect(getSkillYieldMultiplier('mining', 'rune_essence', {}, items as any)).toBe(1)
  })

  it('does nothing for an unrelated skill', () => {
    expect(getSkillYieldMultiplier('woodcutting', 'normal', EQUIPPED, items as any)).toBe(1)
  })

  it('scans every equipment slot, not just one hardcoded slot', () => {
    // The perk is defined by whichever item carries the otherBonus key, not by
    // which slot it sits in — future jewellery in other slots reuses this for
    // free. Here the bracelet is (unrealistically) placed in `weapon` purely to
    // prove the function has no slot-name special case.
    expect(getSkillYieldMultiplier('runecraft', 'craft_air_rune', { weapon: { itemId: 'bracelet_of_runecrafting' } }, items as any)).toBe(2)
  })

  it('returns 1 with a null/undefined equipment object', () => {
    expect(getSkillYieldMultiplier('runecraft', 'craft_air_rune', null, items as any)).toBe(1)
  })
})

describe('bracelet_of_runecrafting item data', () => {
  const item = (items as any).bracelet_of_runecrafting

  it('exists, is gloves-slot, untradeable, and requires Runecrafting 70 to equip', () => {
    expect(item).toBeTruthy()
    expect(item.slot).toBe('gloves')
    expect(item.stackable).toBe(false)
    expect(item.isUntradeable).toBe(true)
    expect(item.isBossUnique).toBe(true)
    expect(item.shopValue).toBe(1000000)
    expect(item.requirements).toEqual({ runecraft: 70 })
  })

  it('carries the two yield-bonus otherBonus keys the engine reads', () => {
    expect(item.otherBonus.runecraftYieldPercent).toBe(100)
    expect(item.otherBonus.essenceYieldPercent).toBe(100)
  })
})

describe('shroudwraith_specter drops the bracelet at 1/256', () => {
  it('is present with the expected drop chance', () => {
    const drop = (monsters as any).shroudwraith_specter.drops.find((d: any) => d.itemId === 'bracelet_of_runecrafting')
    expect(drop).toBeTruthy()
    expect(drop.chance).toBeCloseTo(1 / 256, 10)
    expect(drop.quantity).toBe(1)
  })

  it('has a collection log slot under Shroudwraith Specter', () => {
    expect(monsterHasLoggedDrop('shroudwraith_specter')).toBe(true)
    const monstersCategory = (collectionLog as any).categories.find((c: any) => c.id === 'monsters')
    const section = monstersCategory.sections.find((s: any) => s.id === 'shroudwraith_specter')
    expect(section.items).toContain('bracelet_of_runecrafting')
  })
})

describe('runecrafting idle simulation with the bracelet equipped', () => {
  it('doubles rune output vs. unequipped', () => {
    const action = (skills as any).runecraft.actions.find((a: any) => a.id === 'craft_air_rune')
    const equippedInv = [{ itemId: 'rune_essence', quantity: 10 }, ...Array(27).fill(null)]
    const baseInv = [{ itemId: 'rune_essence', quantity: 10 }, ...Array(27).fill(null)]

    const equippedSim = simulateIdleSkilling({ skill: 'runecraft', action } as any, 60_000, {}, EQUIPPED, {}, items as any, equippedInv as any)
    const baseSim = simulateIdleSkilling({ skill: 'runecraft', action } as any, 60_000, {}, {}, {}, items as any, baseInv as any)

    expect(equippedSim?.actions).toBe(10)
    expect(baseSim?.actions).toBe(10)
    const equippedGained = (equippedSim?.itemsGained.air_rune || 0) + (equippedSim?.itemsBanked.air_rune || 0)
    const baseGained = (baseSim?.itemsGained.air_rune || 0) + (baseSim?.itemsBanked.air_rune || 0)
    expect(baseGained).toBe(10)
    expect(equippedGained).toBe(20)
  })

  it('inventory- or bank-only bracelet grants no bonus — it must be equipped', () => {
    // The function only ever reads the `equipment` argument; passing it as
    // ordinary inventory/bank content (never as `equipment`) is the guarantee
    // that holding it does nothing, exercised end-to-end here.
    const action = (skills as any).runecraft.actions.find((a: any) => a.id === 'craft_air_rune')
    const inv = [{ itemId: 'rune_essence', quantity: 10 }, { itemId: 'bracelet_of_runecrafting', quantity: 1 }, ...Array(26).fill(null)]
    const sim = simulateIdleSkilling({ skill: 'runecraft', action } as any, 60_000, {}, {}, {}, items as any, inv as any)
    const gained = (sim?.itemsGained.air_rune || 0) + (sim?.itemsBanked.air_rune || 0)
    expect(gained).toBe(10)
  })
})

describe('mining idle simulation with the bracelet equipped', () => {
  it('doubles rune essence gathered', () => {
    const action = (skills as any).mining.actions.find((a: any) => a.id === 'rune_essence')
    const equippedSim = simulateIdleSkilling({ skill: 'mining', action } as any, 12_000, {}, EQUIPPED, {}, items as any, Array(28).fill(null) as any)
    const baseSim = simulateIdleSkilling({ skill: 'mining', action } as any, 12_000, {}, {}, {}, items as any, Array(28).fill(null) as any)

    const equippedGained = (equippedSim?.itemsGained.rune_essence || 0) + (equippedSim?.itemsBanked.rune_essence || 0)
    const baseGained = (baseSim?.itemsGained.rune_essence || 0) + (baseSim?.itemsBanked.rune_essence || 0)
    expect(baseGained).toBeGreaterThan(0)
    expect(equippedGained).toBe(baseGained * 2)
  })

  it('does not double a different mining action (iron ore)', () => {
    const action = (skills as any).mining.actions.find((a: any) => a.id === 'iron')
    const equippedSim = simulateIdleSkilling({ skill: 'mining', action } as any, 12_000, {}, EQUIPPED, {}, items as any, Array(28).fill(null) as any)
    const baseSim = simulateIdleSkilling({ skill: 'mining', action } as any, 12_000, {}, {}, {}, items as any, Array(28).fill(null) as any)

    const equippedGained = (equippedSim?.itemsGained.iron_ore || 0) + (equippedSim?.itemsBanked.iron_ore || 0)
    const baseGained = (baseSim?.itemsGained.iron_ore || 0) + (baseSim?.itemsBanked.iron_ore || 0)
    expect(baseGained).toBeGreaterThan(0)
    expect(equippedGained).toBe(baseGained)
  })
})
