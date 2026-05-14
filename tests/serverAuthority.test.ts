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

  it('allows purchases when coins are split between inventory and bank', () => {
    const save: any = { coins: 50, bank: { coins: { quantity: 100 } } }
    expect(() => subtractCoins(save, 125)).not.toThrow()
    expect(save.coins).toBe(0)
    expect(save.bank.coins.quantity).toBe(25)
  })

  it('supports legacy numeric bank coin storage', () => {
    const save: any = { coins: 10, bank: { coins: 90 } }
    expect(() => subtractCoins(save, 60)).not.toThrow()
    expect(save.coins).toBe(0)
    expect(save.bank.coins).toEqual({ itemId: 'coins', quantity: 40 })
  })

  it('enforces inventory slot cap at 28', () => {
    const save: any = { inventory: Array.from({ length: 28 }, (_, i) => ({ itemId: `i${i}`, quantity: 1 })) }
    expect(() => addItemToInventory(save, 'new_item', 1)).toThrow(/Inventory is full/)
  })

  it('ignores empty/null fixed slots when enforcing inventory cap', () => {
    const save: any = { inventory: Array.from({ length: 28 }, () => null) }
    expect(() => addItemToInventory(save, 'new_item', 1)).not.toThrow()
    expect(save.inventory).toEqual([{ itemId: 'new_item', quantity: 1 }])
  })

  it('normalizes legacy id-shaped inventory entries to itemId', () => {
    const save: any = { inventory: [{ id: 'legacy_item', quantity: 1 }] }
    addItemToInventory(save, 'new_item', 1)
    expect(save.inventory[0]).toEqual({ id: 'legacy_item', itemId: 'legacy_item', quantity: 1 })
    expect(save.inventory[1]).toEqual({ itemId: 'new_item', quantity: 1 })
  })

  it('adds non-stackable purchases as separate slots', () => {
    const save: any = { inventory: [{ itemId: 'fighter_helm', quantity: 1 }] }
    addItemToInventory(save, 'fighter_helm', 1, { stackable: false, noted: false })
    expect(save.inventory).toEqual([
      { itemId: 'fighter_helm', quantity: 1 },
      { itemId: 'fighter_helm', quantity: 1 },
    ])
  })

  it('stacks noted non-stackable bulk purchases', () => {
    const save: any = { inventory: [{ itemId: 'fighter_helm', quantity: 2, noted: true }] }
    addItemToInventory(save, 'fighter_helm', 3, { stackable: true, noted: true })
    expect(save.inventory).toEqual([{ itemId: 'fighter_helm', quantity: 5, noted: true }])
  })
})
