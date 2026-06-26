import { describe, expect, it } from 'vitest'
import { simulateIdleSkilling } from '../src/engine/idleEngine.js'

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
