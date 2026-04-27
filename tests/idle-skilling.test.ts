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
    expect(sim?.coinsGained).toBe(48_000)
    expect(sim?.itemsConsumed.nature_rune).toBe(2)
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
    expect(sim?.coinsGained).toBe(72_000)
    expect(sim?.finalInventory[0]).toBeNull()
    expect(sim?.finalInventory[1]).toEqual({ itemId: 'adamant_platebody', quantity: 1, noted: false })
  })
})
