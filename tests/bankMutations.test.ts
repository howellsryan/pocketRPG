import { describe, it, expect } from 'vitest'
import { applyBankDeltas } from '../src/engine/bankMutations.js'

describe('applyBankDeltas', () => {
  it('creates an entry for an item the bank does not hold', () => {
    expect(applyBankDeltas({}, { coal: 25 })).toEqual({ coal: { itemId: 'coal', quantity: 25 } })
  })

  it('adds to an existing entry without touching its other fields', () => {
    const next = applyBankDeltas({ coal: { itemId: 'coal', quantity: 10, charges: 500 } }, { coal: 5 })
    expect(next.coal).toEqual({ itemId: 'coal', quantity: 15, charges: 500 })
  })

  it('removes an entry that a negative delta empties', () => {
    expect(applyBankDeltas({ coal: { itemId: 'coal', quantity: 5 } }, { coal: -5 })).toEqual({})
    expect(applyBankDeltas({ coal: { itemId: 'coal', quantity: 5 } }, { coal: -9 })).toEqual({})
  })

  it('ignores a negative delta for an item the bank does not hold', () => {
    expect(applyBankDeltas({}, { coal: -5 })).toEqual({})
  })

  it('does not mutate the bank it was given', () => {
    const bank = { coal: { itemId: 'coal', quantity: 10 } }
    applyBankDeltas(bank, { coal: -10, shark: 3 })
    expect(bank).toEqual({ coal: { itemId: 'coal', quantity: 10 } })
  })

  // §4: an entry's charges are a pool shared by every banked copy. A deposit
  // ADDS to that pool; forgetting the field must never zero it.
  it('pools incoming charges onto the entry rather than replacing them', () => {
    const next = applyBankDeltas({ trident: { itemId: 'trident', quantity: 1, charges: 2000 } }, { trident: 1 }, { trident: 500 })
    expect(next.trident.charges).toBe(2500)
  })

  it('leaves an existing charge pool untouched when the delta carries none', () => {
    const next = applyBankDeltas({ trident: { itemId: 'trident', quantity: 1, charges: 2000 } }, { trident: 1 })
    expect(next.trident.charges).toBe(2000)
  })

  it('seeds a charge pool on an entry the delta creates', () => {
    const next = applyBankDeltas({}, { trident: 1 }, { trident: 750 })
    expect(next.trident).toEqual({ itemId: 'trident', quantity: 1, charges: 750 })
  })

  it('drops charges along with the entry the delta empties', () => {
    expect(applyBankDeltas({ trident: { itemId: 'trident', quantity: 1, charges: 2000 } }, { trident: -1 }, { trident: 500 })).toEqual({})
  })

  it('treats a junk delta as zero instead of corrupting the entry', () => {
    const next = applyBankDeltas({ coal: { itemId: 'coal', quantity: 10 } }, { coal: NaN as any })
    expect(next.coal.quantity).toBe(10)
  })
})
