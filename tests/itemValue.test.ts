// Loot valuation — drives the high-value purple row highlight and the
// epic (purple) fireworks threshold on the loot/idle/PvP result modals.

import { describe, it, expect } from 'vitest'
import {
  getItemUnitValue,
  isLegendaryItem,
  getLootTotalValue,
  isEpicLootValue,
  hasEpicLootDrop,
  EPIC_LOOT_THRESHOLD,
} from '../src/utils/itemValue.js'

const items = {
  shrimps: { id: 'shrimps', shopValue: 5 },
  rune_sword: { id: 'rune_sword', shopValue: 700_000 },
  legendary_blade: { id: 'legendary_blade', shopValue: 1_000_000 },
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

  it('isLegendaryItem keys off unit value at/above the threshold', () => {
    expect(isLegendaryItem('nether_demon_whip', items)).toBe(true)
    expect(isLegendaryItem('legendary_blade', items)).toBe(true) // exactly 1m qualifies
    expect(isLegendaryItem('rune_sword', items)).toBe(false)
    expect(isLegendaryItem('shrimps', items)).toBe(false)
  })
})

describe('hasEpicLootDrop (purple keys off a single legendary item, not the total)', () => {
  it('is false when no single item is legendary, even if the total exceeds 1m', () => {
    // Two 700k items sum to 1.4m, but neither item is individually legendary.
    const loot = [
      { itemId: 'rune_sword', quantity: 1 },
      { itemId: 'rune_sword', quantity: 1 },
    ]
    expect(getLootTotalValue(loot, items)).toBe(1_400_000)
    expect(hasEpicLootDrop(loot, items)).toBe(false)
  })

  it('is false for a large stack of cheap items even when the stack value exceeds 1m', () => {
    // 2 × 700k = 1.4m in a single stack, but rune_sword is not legendary.
    expect(hasEpicLootDrop([{ itemId: 'rune_sword', quantity: 2 }], items)).toBe(false)
    expect(hasEpicLootDrop([{ itemId: 'shrimps', quantity: 1_000_000 }], items)).toBe(false)
  })

  it('is true when at least one legendary item is received', () => {
    const loot = [
      { itemId: 'shrimps', quantity: 3 },
      { itemId: 'nether_demon_whip', quantity: 1 },
    ]
    expect(hasEpicLootDrop(loot, items)).toBe(true)
  })

  it('accepts a map and handles empty/null loot', () => {
    expect(hasEpicLootDrop({ nether_demon_whip: 1 }, items)).toBe(true)
    expect(hasEpicLootDrop({ shrimps: 1000 }, items)).toBe(false)
    expect(hasEpicLootDrop(null, items)).toBe(false)
    expect(hasEpicLootDrop([], items)).toBe(false)
  })
})
