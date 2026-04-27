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
})
