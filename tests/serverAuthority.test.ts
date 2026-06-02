import { describe, it, expect } from 'vitest'
import { subtractCoins } from '../functions/_lib/game/economy.js'
import { addItemToInventory } from '../functions/_lib/game/inventory.js'

describe('server authority helpers', () => {
  it('rejects insufficient coins', () => {
    const save: any = { coins: 50 }
    expect(() => subtractCoins(save, 100)).toThrow(/Insufficient/)
  })

  it('allows purchases drawing on bank coins once money_purse is unlocked', () => {
    const save: any = { coins: 50, bank: { coins: { quantity: 100 } }, settings: { unlockedFeatures: ['money_purse'] } }
    expect(() => subtractCoins(save, 125)).not.toThrow()
    expect(save.coins).toBe(0)
    expect(save.bank.coins.quantity).toBe(25)
  })

  it('supports legacy numeric bank coin storage with money_purse unlocked', () => {
    const save: any = { coins: 10, bank: { coins: 90 }, settings: { unlockedFeatures: ['money_purse'] } }
    expect(() => subtractCoins(save, 60)).not.toThrow()
    expect(save.coins).toBe(0)
    expect(save.bank.coins).toEqual({ itemId: 'coins', quantity: 40 })
  })

  it('refuses to spend bank coins without the money_purse unlock', () => {
    const save: any = { coins: 50, bank: { coins: { quantity: 100 } } }
    expect(() => subtractCoins(save, 125)).toThrow(/Insufficient/)
    // Nothing should be debited from a failed purchase.
    expect(save.coins).toBe(50)
    expect(save.bank.coins.quantity).toBe(100)
  })

  it('spends only inventory coins (never bank) when money_purse is locked', () => {
    const save: any = {
      coins: 0,
      inventory: [{ itemId: 'coins', quantity: 80 }],
      bank: { coins: { quantity: 1000 } },
    }
    expect(() => subtractCoins(save, 80)).not.toThrow()
    expect(save.inventory.find((s: any) => s?.itemId === 'coins')).toBeUndefined()
    expect(save.bank.coins.quantity).toBe(1000)
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
