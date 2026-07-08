import { describe, expect, it } from 'vitest'
import { simulateIdleSkilling } from '../src/engine/idleEngine.js'
import { getLevelFromXP } from '../src/engine/experience.js'
import skillsData from '../src/data/skills.json'
import itemsData from '../src/data/items.json'

describe('simulateIdleSkilling (alchemy)', () => {
  it('returns null when there are no selected alchemy items in inventory', () => {
    const sim = simulateIdleSkilling(
      {
        skill: 'magic',
        action: { name: 'High Alchemy', type: 'alchemy', ticks: 5, xp: 65, runeReq: { nature_rune: 1, fire_rune: 5 } },
        selectedAlchemyItem: { itemId: 'adamant_platebody' }
      } as any,
      60_000,
      { nature_rune: { quantity: 100 }, fire_rune: { quantity: 500 } } as any,
      {} as any,
      {} as any,
      { adamant_platebody: { shopValue: 16000 } } as any,
      Array(28).fill(null)
    )

    expect(sim).toBeNull()
  })

  it('caps alchemy actions to available selected items', () => {
    const sim = simulateIdleSkilling(
      {
        skill: 'magic',
        action: { name: 'High Alchemy', type: 'alchemy', ticks: 5, xp: 65, runeReq: { nature_rune: 1 } },
        selectedAlchemyItem: { itemId: 'adamant_platebody' }
      } as any,
      60_000,
      { nature_rune: { quantity: 100 } } as any,
      {} as any,
      {} as any,
      { adamant_platebody: { shopValue: 16000 } } as any,
      [{ itemId: 'adamant_platebody', quantity: 2 }, ...Array(27).fill(null)] as any
    )

    expect(sim).toBeTruthy()
    expect(sim?.actions).toBe(2)
    expect(sim?.coinsGained).toBe(35_200)
    expect(sim?.itemsConsumed.nature_rune).toBe(2)
  })

  it('pays Ironmen the reduced Ironman alch value', () => {
    const sim = simulateIdleSkilling(
      {
        skill: 'magic',
        action: { name: 'High Alchemy', type: 'alchemy', ticks: 5, xp: 65, runeReq: { nature_rune: 1 } },
        selectedAlchemyItem: { itemId: 'adamant_platebody' }
      } as any,
      60_000,
      { nature_rune: { quantity: 100 } } as any,
      {} as any,
      {} as any,
      { adamant_platebody: { shopValue: 16000 } } as any,
      [{ itemId: 'adamant_platebody', quantity: 2 }, ...Array(27).fill(null)] as any,
      { isIronman: true }
    )

    expect(sim?.actions).toBe(2)
    // Ironman alch = floor(floor(16000 * 0.4) * 1.1) = floor(6400 * 1.1) = 7040 per action.
    expect(sim?.coinsGained).toBe(14_080)
  })

  it('can alch noted items and only consumes the selected noted form', () => {
    const sim = simulateIdleSkilling(
      {
        skill: 'magic',
        action: { name: 'High Alchemy', type: 'alchemy', ticks: 5, xp: 65, runeReq: { nature_rune: 1 } },
        selectedAlchemyItem: { itemId: 'adamant_platebody', noted: true }
      } as any,
      60_000,
      { nature_rune: { quantity: 100 } } as any,
      {} as any,
      {} as any,
      { adamant_platebody: { shopValue: 16000 } } as any,
      [
        { itemId: 'adamant_platebody', quantity: 3, noted: true },
        { itemId: 'adamant_platebody', quantity: 1, noted: false },
        ...Array(26).fill(null)
      ] as any
    )

    expect(sim).toBeTruthy()
    expect(sim?.actions).toBe(3)
    expect(sim?.coinsGained).toBe(52_800)
    expect(sim?.finalInventory[0]).toBeNull()
    expect(sim?.finalInventory[1]).toEqual({ itemId: 'adamant_platebody', quantity: 1, noted: false })
  })
})

describe('simulateIdleSkilling (dungeoneering)', () => {
  it('awards dungeoneering tokens for training actions', () => {
    const sim = simulateIdleSkilling(
      { skill: 'dungeoneering', action: { name: 'Dungeon', ticks: 5, xp: 1000, category: 'training' } } as any,
      9_000,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      Array(28).fill(null) as any
    )
    expect(sim?.actions).toBe(3)
    expect(sim?.xpGained.dungeoneering).toBe(3000)
    expect(sim?.dungeoneeringTokensGained).toBe(450)
  })

  it('does not allow timed idle reward unlocks for dungeoneering', () => {
    const sim = simulateIdleSkilling(
      { skill: 'dungeoneering', action: { name: 'Reward', category: 'reward', product: 'chaotic_rapier', tokenCost: 300000, ticks: 9999, xp: 0 } } as any,
      999_999,
      {} as any
    )
    expect(sim).toBeNull()
  })
})

describe('simulateIdleSkilling (enchant bolts)', () => {
  it('uses inventory + bank materials and tracks only bank consumption in itemsConsumed', () => {
    const sim = simulateIdleSkilling(
      {
        skill: 'magic',
        action: {
          id: 'enchant_ruby_bolts',
          name: 'Enchant Ruby Bolts (10)',
          type: 'enchant_bolts',
          ticks: 3,
          xp: 59,
          product: 'ruby_bolt_e',
          productQty: 10,
          materials: { ruby_bolt: 10 },
          runeReq: { cosmic_rune: 1, blood_rune: 1, fire_rune: 5 },
        },
      } as any,
      3_600_000,
      { ruby_bolt: { quantity: 20 }, cosmic_rune: { quantity: 200 }, blood_rune: { quantity: 200 }, fire_rune: { quantity: 1000 } } as any,
      {} as any,
      {} as any,
      { ruby_bolt_e: { stackable: true } } as any,
      [{ itemId: 'ruby_bolt', quantity: 30 }, ...Array(27).fill(null)] as any
    )

    expect(sim).toBeTruthy()
    expect(sim?.actions).toBe(5)
    expect(sim?.itemsConsumed.ruby_bolt).toBe(20)
    expect(sim?.finalInventory[0]).toEqual({ itemId: 'ruby_bolt_e', quantity: 50 })
    const totalProduced = (sim?.itemsGained.ruby_bolt_e || 0) + (sim?.itemsBanked.ruby_bolt_e || 0)
    expect(totalProduced).toBe(50)
  })
})

describe('simulateIdleSkilling (bank-trip material loss regression)', () => {
  // Bars/ores are non-stackable, so a long smithing skip fills the 28-slot
  // inventory and forces repeated agility-scaled bank trips. Those trips eat
  // into the elapsed-time budget, so fewer actions can complete than the
  // initial time/material estimate — materials/XP must track the real count,
  // not the estimate, or the shortfall is silently destroyed.
  function xpForLevel(target: number) {
    let xp = 0
    while (getLevelFromXP(xp) < target) xp += 100
    return xp
  }

  it('never consumes more ore than bars actually produced when bank trips truncate the session', () => {
    const action = (skillsData as any).smithing.actions.find((a: any) => a.id === 'smelt_iron')
    const task: any = { type: 'skill', skill: 'smithing', action, bankingEnabled: true }
    const bank: any = { iron_ore: { quantity: 2830 } }
    const inventory: any = new Array(28).fill(null)
    const stats: any = { smithing: { xp: 300000 }, agility: { xp: xpForLevel(1) } }

    const sim = simulateIdleSkilling(task, 2 * 60 * 60 * 1000, bank, {}, stats, itemsData as any, inventory, {})

    expect(sim).toBeTruthy()
    const invBars = sim!.finalInventory.filter((s: any) => s?.itemId === 'iron_bar').reduce((a: number, s: any) => a + s.quantity, 0)
    const totalBars = (sim!.itemsBanked.iron_bar || 0) + invBars
    // Fewer than the full 2830 ore complete within 2 hours at agility 1 (long
    // bank-trip delay) — the point is that whatever *did* consume ore must
    // have produced exactly that many bars, XP, and a matching action count.
    expect(sim!.actions).toBeLessThan(2830)
    expect(totalBars).toBe(sim!.actions)
    expect(sim!.itemsConsumed.iron_ore || 0).toBe(sim!.actions)
    expect(sim!.xpGained.smithing).toBe(sim!.actions * action.xp)
  })
})
