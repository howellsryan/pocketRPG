import { describe, it, expect } from 'vitest'
import { detectProtectedDelta } from '../functions/_lib/game/saveValidation.js'
import { subtractCoins } from '../functions/_lib/game/economy.js'
import { addItemToInventory } from '../functions/_lib/game/inventory.js'

describe('server authority helpers', () => {
  it('flags protected item inventory increases', () => {
    const prev = { inventory: [{ id: 'bronze_sword', quantity: 1 }] }
    const next = { inventory: [{ id: 'bronze_sword', quantity: 1 }, { id: 'dragon_claws', quantity: 1 }] }
    const items = { dragon_claws: { isBossUnique: true } }
    expect(detectProtectedDelta(prev, next, items)).toEqual(['dragon_claws'])
  })

  it('rejects insufficient coins', () => {
    const save: any = { coins: 50 }
    expect(() => subtractCoins(save, 100)).toThrow(/Insufficient/)
  })

  it('enforces inventory slot cap at 28', () => {
    const save: any = { inventory: Array.from({ length: 28 }, (_, i) => ({ id: `i${i}`, quantity: 1 })) }
    expect(() => addItemToInventory(save, 'new_item', 1)).toThrow(/Inventory is full/)
  })

  it('ignores empty/null fixed slots when enforcing inventory cap', () => {
    const save: any = { inventory: Array.from({ length: 28 }, () => null) }
    expect(() => addItemToInventory(save, 'new_item', 1)).not.toThrow()
    expect(save.inventory).toEqual([{ id: 'new_item', quantity: 1 }])
  })
})
