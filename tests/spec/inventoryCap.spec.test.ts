// INVARIANT (CLAUDE.md §4): inventory cap = 28 slots.
// Source of truth: src/engine/inventory.js + src/utils/constants.js.
import { describe, it, expect } from 'vitest'
import { INVENTORY_SIZE } from '../../src/utils/constants.js'
import { createInventory, freeSlots, canFit, addItem } from '../../src/engine/inventory.js'

describe('inventory cap invariant (28 slots)', () => {
  it('a fresh inventory has exactly 28 empty slots', () => {
    expect(INVENTORY_SIZE).toBe(28)
    const inv = createInventory()
    expect(inv.length).toBe(28)
    expect(freeSlots(inv)).toBe(28)
  })

  it('cannot fit 29 distinct non-stackable items', () => {
    const inv = createInventory()
    const req: Record<string, number> = {}
    for (let i = 0; i < 29; i++) req['sword_' + i] = 1
    expect(canFit(inv, req, {})).toBe(false)
    // 28 exactly fits.
    delete req['sword_28']
    expect(canFit(inv, req, {})).toBe(true)
  })

  it('addItem refuses a non-stackable item once all 28 slots are used', () => {
    const inv = createInventory()
    for (let i = 0; i < 28; i++) expect(addItem(inv, 'sword_' + i, 1, false)).toBe(true)
    expect(freeSlots(inv)).toBe(0)
    expect(addItem(inv, 'one_too_many', 1, false)).toBe(false)
  })
})
