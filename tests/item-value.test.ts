import { describe, it, expect } from 'vitest'
import { isHighValueDrop } from '../src/utils/itemValue.js'

const itemsData: any = {
  expensive: { shopValue: 1_000_001 },
  exact: { shopValue: 1_000_000 },
  stack: { shopValue: 600_000 },
  novalue: { shopValue: 0 },
}

describe('isHighValueDrop', () => {
  it('returns false for missing item', () => {
    expect(isHighValueDrop('missing', 1, itemsData)).toBe(false)
  })

  it('returns false for missing/zero value', () => {
    expect(isHighValueDrop('novalue', 1, itemsData)).toBe(false)
  })

  it('returns false at exactly 1,000,000 total', () => {
    expect(isHighValueDrop('exact', 1, itemsData)).toBe(false)
    expect(isHighValueDrop('coins', 1_000_000, itemsData)).toBe(false)
  })

  it('returns true above 1,000,000 total', () => {
    expect(isHighValueDrop('expensive', 1, itemsData)).toBe(true)
    expect(isHighValueDrop('coins', 1_000_001, itemsData)).toBe(true)
  })

  it('uses quantity multiplication', () => {
    expect(isHighValueDrop('stack', 2, itemsData)).toBe(true)
  })
})
