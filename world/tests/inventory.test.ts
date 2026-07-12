// Phase 4 pack reordering: pure slot-move semantics, flush-invariance, and the
// moveInv wire-message guard.
import { describe, expect, it } from 'vitest'
import { emptyInventory, inventoryToItems, moveInventorySlot } from '../server/mining'
import { parseClientMessage } from '../shared/protocol'
import type { InvSlot } from '../shared/protocol'

function packWith(entries: Record<number, InvSlot>): InvSlot[] {
  const inv = emptyInventory()
  for (const [index, slot] of Object.entries(entries)) inv[Number(index)] = slot
  return inv
}

describe('moveInventorySlot', () => {
  it('relocates into an empty slot', () => {
    const inv = packWith({ 0: { itemId: 'tin_ore', quantity: 1 } })
    expect(moveInventorySlot(inv, 0, 5)).toBe(true)
    expect(inv[0]).toBeNull()
    expect(inv[5]).toEqual({ itemId: 'tin_ore', quantity: 1 })
  })

  it('swaps two filled slots', () => {
    const inv = packWith({ 0: { itemId: 'tin_ore', quantity: 1 }, 3: { itemId: 'bones', quantity: 1 } })
    expect(moveInventorySlot(inv, 0, 3)).toBe(true)
    expect(inv[0]).toEqual({ itemId: 'bones', quantity: 1 })
    expect(inv[3]).toEqual({ itemId: 'tin_ore', quantity: 1 })
  })

  it('rejects empty source, same slot, and out-of-range indexes', () => {
    const inv = packWith({ 0: { itemId: 'tin_ore', quantity: 1 } })
    expect(moveInventorySlot(inv, 1, 2)).toBe(false)
    expect(moveInventorySlot(inv, 0, 0)).toBe(false)
    expect(moveInventorySlot(inv, 0, 28)).toBe(false)
    expect(moveInventorySlot(inv, -1, 0)).toBe(false)
    expect(inv[0]).toEqual({ itemId: 'tin_ore', quantity: 1 })
  })

  it('never changes what a flush would grant — slot order is cosmetic', () => {
    const inv = packWith({ 0: { itemId: 'tin_ore', quantity: 3 }, 1: { itemId: 'bones', quantity: 1 }, 9: { itemId: 'cowhide', quantity: 1 } })
    const byId = (rows: { itemId: string; quantity: number }[]) => [...rows].sort((a, b) => a.itemId.localeCompare(b.itemId))
    const before = byId(inventoryToItems(inv))
    moveInventorySlot(inv, 0, 27)
    moveInventorySlot(inv, 1, 9)
    expect(byId(inventoryToItems(inv))).toEqual(before)
  })
})

describe('moveInv protocol guard', () => {
  it('accepts integer slots in [0,28)', () => {
    expect(parseClientMessage({ t: 'moveInv', from: 0, to: 27 })).toEqual({ t: 'moveInv', from: 0, to: 27 })
  })

  it('rejects non-integers and out-of-range slots', () => {
    expect(parseClientMessage({ t: 'moveInv', from: 0.5, to: 3 })).toBeNull()
    expect(parseClientMessage({ t: 'moveInv', from: 0, to: 28 })).toBeNull()
    expect(parseClientMessage({ t: 'moveInv', from: -1, to: 3 })).toBeNull()
    expect(parseClientMessage({ t: 'moveInv', from: '1', to: 3 })).toBeNull()
  })
})
