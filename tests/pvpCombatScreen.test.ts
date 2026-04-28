import { describe, expect, it } from 'vitest'
import { getPvpFoodSlots } from '../src/screens/PvpCombatScreen.jsx'

describe('getPvpFoodSlots', () => {
  it('recognizes food items using heals', () => {
    const inventory = [
      { itemId: 'shark', quantity: 1 },
      { itemId: 'lobster', quantity: 2 },
      { itemId: 'logs', quantity: 1 },
    ]
    const itemsData: any = {
      shark: { id: 'shark', heals: 20 },
      lobster: { id: 'lobster', heal: 12 },
      logs: { id: 'logs' },
    }

    const slots = getPvpFoodSlots(inventory, itemsData, 4)
    expect(slots.map((entry: any) => entry.slot.itemId)).toEqual(['shark', 'lobster'])
  })
})
