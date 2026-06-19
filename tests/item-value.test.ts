import { describe, it, expect } from 'vitest'
import { isLegendaryItem } from '../src/utils/itemValue.js'

const itemsData: any = {
  expensive: { shopValue: 1_000_001 },
  exact: { shopValue: 1_000_000 },
  stack: { shopValue: 600_000 },
  novalue: { shopValue: 0 },
}

describe('isLegendaryItem', () => {
  it('returns false for missing item', () => {
    expect(isLegendaryItem('missing', itemsData)).toBe(false)
  })

  it('returns false for missing/zero value', () => {
    expect(isLegendaryItem('novalue', itemsData)).toBe(false)
  })

  it('returns true at exactly 1,000,000 (matches the Legendary rarity label)', () => {
    expect(isLegendaryItem('exact', itemsData)).toBe(true)
  })

  it('returns true above 1,000,000', () => {
    expect(isLegendaryItem('expensive', itemsData)).toBe(true)
  })

  it('keys off unit value only — quantity is irrelevant', () => {
    // A 600k item is never legendary, no matter how many drop. (The old
    // stack-based behaviour would have turned a stack worth >1m purple.)
    expect(isLegendaryItem('stack', itemsData)).toBe(false)
    // Coins (unit value 1) are never legendary, even an enormous pile.
    expect(isLegendaryItem('coins', itemsData)).toBe(false)
  })
})
