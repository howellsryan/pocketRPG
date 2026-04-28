import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'
import { validateIntentAction } from '../functions/api/pvp/match/[id]/intent.js'

function stateWithInventory(itemId: string) {
  return {
    combatants: {
      '1': {
        characterId: 1,
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
})
