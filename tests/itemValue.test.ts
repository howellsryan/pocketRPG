// Loot valuation — drives the high-value purple row highlight and the
// epic (purple) fireworks threshold on the loot/idle/PvP result modals.

import { describe, it, expect } from 'vitest'
import {
  getItemUnitValue,
  isHighValueDrop,
  getLootTotalValue,
  isEpicLootValue,
  hasEpicLootDrop,
  EPIC_LOOT_THRESHOLD,
} from '../src/utils/itemValue.js'

const items = {
  shrimps: { id: 'shrimps', shopValue: 5 },
  rune_sword: { id: 'rune_sword', shopValue: 700_000 },
  nether_demon_whip: { id: 'nether_demon_whip', shopValue: 1_500_000 },
  fire_cape: { id: 'fire_cape', shopValue: 0 },
}

describe('getItemUnitValue', () => {
  it('reads shopValue and treats coins as 1', () => {
    expect(getItemUnitValue('shrimps', items)).toBe(5)
    expect(getItemUnitValue('coins', items)).toBe(1)
  })

  it('returns null for zero/unknown values', () => {
    expect(getItemUnitValue('fire_cape', items)).toBeNull()
    expect(getItemUnitValue('not_an_item', items)).toBeNull()
  })
})

describe('getLootTotalValue', () => {
  it('sums an array of { itemId, quantity } entries', () => {
    const loot = [
      { itemId: 'shrimps', quantity: 10 },
      { itemId: 'coins', quantity: 250 },
      { itemId: 'fire_cape', quantity: 1 }, // valueless — ignored
    ]
    expect(getLootTotalValue(loot, items)).toBe(300)
  })

  it('sums an { itemId: quantity } map', () => {
    expect(getLootTotalValue({ shrimps: 4, coins: 30 }, items)).toBe(50)
  })

  it('handles null/empty loot and null slots', () => {
    expect(getLootTotalValue(null, items)).toBe(0)
    expect(getLootTotalValue([], items)).toBe(0)
    expect(getLootTotalValue([null, { itemId: 'shrimps', quantity: 1 }], items)).toBe(5)
  })
})

describe('epic loot threshold (purple fireworks)', () => {
  it('triggers strictly above 1,000,000 total value', () => {
    expect(EPIC_LOOT_THRESHOLD).toBe(1_000_000)
    expect(isEpicLootValue(1_000_000)).toBe(false)
    expect(isEpicLootValue(1_000_001)).toBe(true)
  })

  it('a single >1m drop is epic via getLootTotalValue', () => {
    const loot = [{ itemId: 'nether_demon_whip', quantity: 1 }]
    expect(isEpicLootValue(getLootTotalValue(loot, items))).toBe(true)
  })

  it('isHighValueDrop matches the same threshold per drop', () => {
    expect(isHighValueDrop('nether_demon_whip', 1, items)).toBe(true)
    expect(isHighValueDrop('shrimps', 1000, items)).toBe(false)
  })
})

describe('hasEpicLootDrop (purple keys off a single rare item, not the total)', () => {
  it('is false when no single item exceeds 1m, even if the total does', () => {
    // Two 700k items sum to 1.4m, but neither stack is individually >1m.
    const loot = [
      { itemId: 'rune_sword', quantity: 1 },
      { itemId: 'rune_sword', quantity: 1 },
    ]
    expect(getLootTotalValue(loot, items)).toBe(1_400_000)
    expect(hasEpicLootDrop(loot, items)).toBe(false)
  })

  it('is true when at least one item stack exceeds 1m', () => {
    const loot = [
      { itemId: 'shrimps', quantity: 3 },
      { itemId: 'nether_demon_whip', quantity: 1 },
    ]
    expect(hasEpicLootDrop(loot, items)).toBe(true)
  })

  it('counts stack value, so enough copies of a sub-1m item still qualify', () => {
    // 2 × 700k = 1.4m in a single stack.
    expect(hasEpicLootDrop([{ itemId: 'rune_sword', quantity: 2 }], items)).toBe(true)
  })

  it('accepts a map and handles empty/null loot', () => {
    expect(hasEpicLootDrop({ nether_demon_whip: 1 }, items)).toBe(true)
    expect(hasEpicLootDrop({ shrimps: 1000 }, items)).toBe(false)
    expect(hasEpicLootDrop(null, items)).toBe(false)
    expect(hasEpicLootDrop([], items)).toBe(false)
  })
})
