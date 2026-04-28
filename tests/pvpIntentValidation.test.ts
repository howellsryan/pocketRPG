import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'
import { validateIntentAction } from '../functions/api/pvp/match/[id]/intent.js'

function stateWithInventory(itemId: string) {
  return {
    combatants: {
      '1': {
        characterId: 1,
        stats: { prayer: 99 },
        inventory: [{ itemId, quantity: 1 }],
        equipment: {},
      },
    },
  }
}

describe('PvP intent validation food checks', () => {
  it('accepts eat intent for canonical heals food from items.json', () => {
    const shark = itemsData.shark
    expect(shark?.heals).toBeGreaterThan(0)
    const result = validateIntentAction(stateWithInventory('shark'), 1, { type: 'eat', inventorySlot: 0 })
    expect(result).toEqual({ ok: true })
  })

  it('rejects protection prayers with explicit error', () => {
    const state: any = stateWithInventory('shark')
    const result = validateIntentAction(state, 1, { type: 'toggle_prayer', prayerId: 'protection_from_melee' })
    expect(result).toEqual({ ok: false, error: 'protection_prayer_disabled' })
  })

  it('rejects prayers above player prayer level', () => {
    const state: any = stateWithInventory('shark')
    state.combatants['1'].stats.prayer = 1
    const result = validateIntentAction(state, 1, { type: 'toggle_prayer', prayerId: 'piety' })
    expect(result).toEqual({ ok: false, error: 'insufficient_prayer_level' })
  })

  it('accepts supported combat potions and rejects unrelated potions', () => {
    expect(validateIntentAction(stateWithInventory('attack_potion'), 1, { type: 'drink_potion', inventorySlot: 0 })).toEqual({ ok: true })
    expect(validateIntentAction(stateWithInventory('prayer_potion'), 1, { type: 'drink_potion', inventorySlot: 0 })).toEqual({ ok: false, error: 'item_not_potion' })
  })
})
