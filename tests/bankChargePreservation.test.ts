// Banked charges are the player's most expensive stored resource (a maxed
// Trident of Venom holds tens of thousands). The bank keys entries by itemId,
// so any code path that rebuilds an entry from scratch — server-granted loot,
// a preset reshuffle, a bank trip during idle — used to drop `charges` on the
// floor with no way to notice. These tests pin the invariant that makes that
// class of bug impossible: an omitted `charges` field means "untouched", never
// "zero".

import { describe, it, expect } from 'vitest'
import { preserveBankCharges } from '../src/engine/bankCharges.js'
import { applyPreset } from '../src/engine/equipmentPresets.js'
import { simulateIdleSkilling } from '../src/engine/idleEngine.js'

describe('preserveBankCharges', () => {
  it('restores charges a rewritten entry silently dropped', () => {
    // The reported bug: a boss grant routed to the bank rebuilt the entry as a
    // bare { itemId, quantity } while a 20k-charge trident sat in that slot.
    const prev = { trident_of_venom: { itemId: 'trident_of_venom', quantity: 1, charges: 20000 } }
    const next = { trident_of_venom: { itemId: 'trident_of_venom', quantity: 2 } }
    expect(preserveBankCharges(prev, next).trident_of_venom).toEqual({
      itemId: 'trident_of_venom', quantity: 2, charges: 20000,
    })
  })

  it('honours an explicit lower charge count (a partial withdrawal)', () => {
    const prev = { trident_of_venom: { itemId: 'trident_of_venom', quantity: 2, charges: 20000 } }
    const next = { trident_of_venom: { itemId: 'trident_of_venom', quantity: 1, charges: 10000 } }
    expect(preserveBankCharges(prev, next).trident_of_venom.charges).toBe(10000)
  })

  it('honours an explicit zero (uncharging strips the pool deliberately)', () => {
    const prev = { trident_of_venom: { itemId: 'trident_of_venom', quantity: 1, charges: 20000 } }
    const next = { trident_of_venom: { itemId: 'trident_of_venom', quantity: 1, charges: 0 } }
    expect(preserveBankCharges(prev, next).trident_of_venom.charges).toBe(0)
  })

  it('leaves entries alone when the item left the bank entirely', () => {
    const prev = { trident_of_venom: { itemId: 'trident_of_venom', quantity: 1, charges: 20000 } }
    const next = { shrimps: { itemId: 'shrimps', quantity: 5 } }
    expect(preserveBankCharges(prev, next)).toEqual(next)
  })

  it('returns the same object when nothing needed restoring', () => {
    const prev = { shrimps: { itemId: 'shrimps', quantity: 5 } }
    const next = { shrimps: { itemId: 'shrimps', quantity: 6 } }
    expect(preserveBankCharges(prev, next)).toBe(next)
  })

  it('ignores a previous entry whose charge pool was already empty', () => {
    const prev = { trident_of_venom: { itemId: 'trident_of_venom', quantity: 1, charges: 0 } }
    const next = { trident_of_venom: { itemId: 'trident_of_venom', quantity: 1 } }
    expect(preserveBankCharges(prev, next).trident_of_venom.charges).toBeUndefined()
  })
})

describe('applyPreset charge handling', () => {
  const itemsData = {
    trident_of_venom: { id: 'trident_of_venom', name: 'Trident of Venom', slot: 'weapon', scaleCharged: true },
    shrimps: { id: 'shrimps', name: 'Shrimps', stackable: true },
  } as any

  it('keeps every pooled charge when several charged copies stay banked', () => {
    const preset = { equipment: {}, inventory: [] }
    const state = {
      equipment: {},
      inventory: [],
      bank: { trident_of_venom: { itemId: 'trident_of_venom', quantity: 2, charges: 20000 } },
    }
    const result = applyPreset(preset, state, itemsData, {}, new Set())
    expect(result.bank.trident_of_venom.charges).toBe(20000)
  })

  it('merges the charges of two separately charged copies instead of keeping one', () => {
    const preset = { equipment: {}, inventory: [] }
    const state = {
      equipment: { weapon: { itemId: 'trident_of_venom', charges: 5000 } },
      inventory: [{ itemId: 'trident_of_venom', quantity: 1, charges: 20000 }],
      bank: {},
    }
    const result = applyPreset(preset, state, itemsData, {}, new Set())
    expect(result.bank.trident_of_venom.quantity).toBe(2)
    expect(result.bank.trident_of_venom.charges).toBe(25000)
  })

  it('writes an explicit zero when the preset draws the banked charges onto the player', () => {
    // Without the explicit 0 the preserve pass above would restore the pool the
    // preset just moved onto the equipped weapon, duplicating charges.
    const preset = { equipment: { weapon: { itemId: 'trident_of_venom' } }, inventory: [] }
    const state = {
      equipment: {},
      inventory: [],
      bank: { trident_of_venom: { itemId: 'trident_of_venom', quantity: 2, charges: 20000 } },
    }
    const result = applyPreset(preset, state, itemsData, {}, new Set())
    expect(result.equipment.weapon.charges).toBe(20000)
    expect(result.bank.trident_of_venom.charges).toBe(0)
  })
})

describe('idle auto-bank', () => {
  const toolItems = {
    shardglass_pickaxe: { id: 'shardglass_pickaxe', name: 'Shardglass Pickaxe', toolFor: 'mining', requirements: { mining: 70 }, scaleCharged: true },
    adamantite_ore: { id: 'adamantite_ore', name: 'Adamantite Ore' },
  } as any
  const maxedMining = { mining: { xp: 200_000_000 } } as any
  const miningAction = { id: 'adamantite', name: 'Adamantite', xp: 95, ticks: 5, product: 'adamantite_ore', levelReq: 70 } as any
  const pad = (slots: any[]) => [...slots, ...Array(28 - slots.length).fill(null)]

  it('leaves a charged tool in the inventory instead of banking its charges away', () => {
    // A bank trip moved every inventory slot into a quantity-only totals map,
    // so a charged tool that got swept up lost its whole pool.
    const inv = pad([{ itemId: 'shardglass_pickaxe', quantity: 1, charges: 500 }])
    const sim = simulateIdleSkilling(
      { skill: 'mining', action: miningAction } as any,
      60 * 60 * 1000,
      {},
      {},
      maxedMining,
      toolItems,
      inv,
      {},
    ) as any

    // The ore banked proves a bank trip ran; the tool stayed out of it.
    expect(sim.itemsBanked.adamantite_ore).toBeGreaterThan(0)
    expect(sim.itemsBanked.shardglass_pickaxe).toBeUndefined()
    expect(sim.finalInventory.find((s: any) => s?.itemId === 'shardglass_pickaxe')).toBeTruthy()
  })
})
