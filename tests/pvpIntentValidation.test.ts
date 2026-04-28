import { describe, expect, it } from 'vitest'
import { validateIntentAction } from '../functions/api/pvp/match/[id]/intent.js'

describe('validateIntentAction eat action', () => {
  it('accepts food items that use the heals property', () => {
    const state: any = {
      combatants: {
        '101': {
          characterId: 101,
          inventory: [{ itemId: 'shark', quantity: 1 }],
          equipment: {},
        },
      },
    }

    const result = validateIntentAction(state, 101, { type: 'eat', inventorySlot: 0 })
    expect(result).toEqual({ ok: true })
  })
})
