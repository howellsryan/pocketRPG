// Banked charges are immutable — chargeable items (scaleCharged weapons like
// the Venom Blowpipe) must keep their `charges` field through every
// server-side bank rewrite. The trading-post/MCP/action endpoints all run
// normalizeSaveItemIds + addItemToBank/removeItemFromBank on the save before
// writing it back; before this regression suite they rebuilt bank entries as
// bare { itemId, quantity }, silently wiping charges from every banked item.

import { describe, it, expect } from 'vitest'
import {
  normalizeSaveItemIds,
  addItemToBank,
  removeItemFromBank,
} from '../functions/_lib/game/inventory.js'

// Minimal items lookup: one canonical item and one legacy-id mapping.
const items = {
  venom_blowpipe: { id: 'venom_blowpipe', legacy_item_id: 'toxic_blowpipe' },
  shrimps: { id: 'shrimps' },
}

describe('normalizeSaveItemIds bank rewrite', () => {
  it('preserves charges on canonical bank entries', () => {
    const save = {
      bank: {
        venom_blowpipe: { itemId: 'venom_blowpipe', quantity: 1, charges: 8000 },
        shrimps: { itemId: 'shrimps', quantity: 50 },
      },
    }
    normalizeSaveItemIds(save, items)
    expect(save.bank.venom_blowpipe).toEqual({ itemId: 'venom_blowpipe', quantity: 1, charges: 8000 })
    expect(save.bank.shrimps).toEqual({ itemId: 'shrimps', quantity: 50 })
  })

  it('preserves charges through a legacy-id rewrite', () => {
    const save = {
      bank: {
        toxic_blowpipe: { itemId: 'toxic_blowpipe', quantity: 1, charges: 5000 },
      },
    }
    normalizeSaveItemIds(save, items)
    expect(save.bank.toxic_blowpipe).toBeUndefined()
    expect(save.bank.venom_blowpipe).toEqual({ itemId: 'venom_blowpipe', quantity: 1, charges: 5000 })
  })

  it('keeps first-seen charges when a legacy id collides with a canonical entry', () => {
    const save = {
      bank: {
        venom_blowpipe: { itemId: 'venom_blowpipe', quantity: 1, charges: 8000 },
        toxic_blowpipe: { itemId: 'toxic_blowpipe', quantity: 1, charges: 5000 },
      },
    }
    normalizeSaveItemIds(save, items)
    expect(save.bank.venom_blowpipe.quantity).toBe(2)
    expect(save.bank.venom_blowpipe.charges).toBe(8000)
  })
})

describe('addItemToBank', () => {
  it('preserves existing charges when more quantity is merged in', () => {
    const save = {
      bank: { venom_blowpipe: { itemId: 'venom_blowpipe', quantity: 1, charges: 8000 } },
    }
    addItemToBank(save, 'venom_blowpipe', 1)
    expect(save.bank.venom_blowpipe).toEqual({ itemId: 'venom_blowpipe', quantity: 2, charges: 8000 })
  })

  it('creates plain entries for new items', () => {
    const save = { bank: {} }
    addItemToBank(save, 'shrimps', 10)
    expect(save.bank.shrimps).toEqual({ itemId: 'shrimps', quantity: 10 })
  })
})

describe('removeItemFromBank', () => {
  it('preserves charges through a partial withdrawal', () => {
    const save = {
      bank: { venom_blowpipe: { itemId: 'venom_blowpipe', quantity: 2, charges: 8000 } },
    }
    removeItemFromBank(save, 'venom_blowpipe', 1)
    expect(save.bank.venom_blowpipe).toEqual({ itemId: 'venom_blowpipe', quantity: 1, charges: 8000 })
  })

  it('removes the entry entirely when quantity reaches zero', () => {
    const save = {
      bank: { venom_blowpipe: { itemId: 'venom_blowpipe', quantity: 1, charges: 8000 } },
    }
    removeItemFromBank(save, 'venom_blowpipe', 1)
    expect(save.bank.venom_blowpipe).toBeUndefined()
  })
})
