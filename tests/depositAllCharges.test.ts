// The inventory-full prompt's "Deposit All" used to sum quantities only: it
// banked item types the player had flagged as excluded from auto-bank, and it
// dropped every deposited slot's `charges` on the floor (a fully charged
// Shardglass Axe banked as a bare item). Both live here now so the rule is one
// pure function instead of a loop inlined in App.jsx.

import { describe, it, expect } from 'vitest'
import { collectDepositAll, sumSlotCharges } from '../src/engine/inventory.js'

const axe = (charges: number) => ({ itemId: 'shardglass_axe', quantity: 1, charges })

describe('collectDepositAll', () => {
  it('pools the charges of every deposited copy onto the bank update', () => {
    const inventory: any = [axe(600), axe(400), { itemId: 'iron_ore', quantity: 5 }]
    const result = collectDepositAll(inventory)

    expect(result.updates).toEqual({ shardglass_axe: 2, iron_ore: 5 })
    expect(result.charges).toEqual({ shardglass_axe: 1000 })
    expect(result.deposited).toBe(3)
    expect(result.inventory).toEqual([null, null, null])
  })

  it('carries charges for every charged item type independently', () => {
    const inventory: any = [
      { itemId: 'trident_of_venom', quantity: 1, charges: 20000 },
      { itemId: 'scythe_of_vythar', quantity: 1, charges: 750 },
      { itemId: 'venom_blowpipe', quantity: 1, charges: 5 },
    ]
    expect(collectDepositAll(inventory).charges).toEqual({
      trident_of_venom: 20000, scythe_of_vythar: 750, venom_blowpipe: 5,
    })
  })

  it('leaves auto-bank-excluded item types in the inventory, charges intact', () => {
    const inventory: any = [axe(1000), { itemId: 'iron_ore', quantity: 5 }, null]
    const result = collectDepositAll(inventory, new Set(['shardglass_axe']))

    expect(result.updates).toEqual({ iron_ore: 5 })
    expect(result.charges).toEqual({})
    expect(result.deposited).toBe(1)
    expect(result.inventory).toEqual([axe(1000), null, null])
  })

  it('deposits nothing when every occupied slot is excluded', () => {
    const inventory: any = [axe(1000), axe(50)]
    const result = collectDepositAll(inventory, new Set(['shardglass_axe']))

    expect(result.deposited).toBe(0)
    expect(result.updates).toEqual({})
    expect(result.inventory).toEqual(inventory)
  })

  it('omits a charge entry entirely for uncharged items so the bank pool stays untouched', () => {
    // An absent `charges` field means "untouched" on a bank rewrite (§4), so an
    // uncharged deposit must not write a 0 that would wipe the banked pool.
    const result = collectDepositAll([{ itemId: 'shardglass_axe', quantity: 1 }] as any)
    expect(result.charges).toEqual({})
    expect('shardglass_axe' in result.charges).toBe(false)
  })
})

describe('sumSlotCharges', () => {
  it('totals the charges of the copies actually deposited', () => {
    const inventory: any = [axe(600), axe(400), axe(90)]
    expect(sumSlotCharges(inventory, 'shardglass_axe', 2)).toBe(1000)
  })

  it('ignores noted stacks and other item types', () => {
    const inventory: any = [
      { itemId: 'shardglass_axe', quantity: 3, charges: 999, noted: true },
      axe(120),
      { itemId: 'trident_of_venom', quantity: 1, charges: 500 },
    ]
    expect(sumSlotCharges(inventory, 'shardglass_axe', 5)).toBe(120)
  })

  it('returns 0 when nothing carries charges', () => {
    expect(sumSlotCharges([{ itemId: 'iron_ore', quantity: 5 }] as any, 'iron_ore', 5)).toBe(0)
  })
})
