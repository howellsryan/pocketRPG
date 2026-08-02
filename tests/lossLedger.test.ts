// The declared item-loss ledger (Phase 3 of the item-loss safety net). It only
// ever makes the server report LESS, so the cases that matter are the ones where
// it must NOT carry a claim forward: a window the server has already superseded,
// and a delta that asked for more than the bank could give.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readItemLossLedger,
  recordItemLosses,
  resetItemLossLedger,
  settleItemLossLedger,
} from '../src/engine/lossLedger.js'
import { applyBankDeltas, bankUnitsRemoved } from '../src/engine/bankMutations.js'

beforeEach(() => resetItemLossLedger())

describe('lossLedger', () => {
  it('aggregates declarations by item and reports null when empty', () => {
    expect(readItemLossLedger()).toBeNull()
    recordItemLosses({ empty_pouch: 200, blue_charm: 200 })
    recordItemLosses({ empty_pouch: 50 })
    expect(readItemLossLedger()).toEqual({ empty_pouch: 250, blue_charm: 200 })
  })

  it('ignores non-positive and malformed entries', () => {
    recordItemLosses({ empty_pouch: 0, blue_charm: -5, steel_platebody: 'many' as any, '': 4 })
    expect(readItemLossLedger()).toBeNull()
  })

  // A push is on the wire for a round trip. Anything spent in that window
  // belongs to the NEXT save's ledger, so a successful push subtracts what it
  // shipped rather than clearing — clearing would drop the newer spend, and the
  // next save would then flag it as unexplained.
  it('settles by subtracting what a push shipped, keeping what arrived after', () => {
    recordItemLosses({ empty_pouch: 200 })
    const shipped = readItemLossLedger()!
    recordItemLosses({ empty_pouch: 30, blue_charm: 10 })

    settleItemLossLedger(shipped)
    expect(readItemLossLedger()).toEqual({ empty_pouch: 30, blue_charm: 10 })
  })

  it('keeps the ledger when a push does not settle, so the retry covers the wider window', () => {
    recordItemLosses({ empty_pouch: 200 })
    recordItemLosses({ empty_pouch: 200 })
    expect(readItemLossLedger()).toEqual({ empty_pouch: 400 })
  })

  it('resets outright, for adopting a server copy', () => {
    recordItemLosses({ empty_pouch: 200 })
    resetItemLossLedger()
    expect(readItemLossLedger()).toBeNull()
  })
})

describe('bankUnitsRemoved', () => {
  // A negative delta is a REQUEST, not an outcome: applyBankDeltas floors an
  // entry at removal and ignores a debit against an item the bank does not hold.
  // Declaring the request would over-declare, and a real loss of that same item
  // could then hide behind the excess.
  it('declares what left the bank, not what the delta asked for', () => {
    const before = { empty_pouch: { itemId: 'empty_pouch', quantity: 50 } }
    const deltas = { empty_pouch: -200, blue_charm: -100 }
    const after = applyBankDeltas(before, deltas)
    expect(bankUnitsRemoved(before, after, deltas)).toEqual({ empty_pouch: 50 })
  })

  it('declares nothing for a deposit', () => {
    const before = {}
    const deltas = { empty_pouch: 200 }
    expect(bankUnitsRemoved(before, applyBankDeltas(before, deltas), deltas)).toEqual({})
  })

  it('declares only the debited half of a mixed delta', () => {
    const before = {
      empty_pouch: { itemId: 'empty_pouch', quantity: 500 },
      steel_titan_pouch: { itemId: 'steel_titan_pouch', quantity: 1 },
    }
    const deltas = { empty_pouch: -200, steel_titan_pouch: 200 }
    const after = applyBankDeltas(before, deltas)
    expect(bankUnitsRemoved(before, after, deltas)).toEqual({ empty_pouch: 200 })
  })
})
