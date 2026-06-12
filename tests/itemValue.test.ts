// Loot valuation — drives the high-value purple row highlight and the
// epic (purple) fireworks threshold on the loot/idle/PvP result modals.

import { describe, it, expect } from 'vitest'
import {
  getItemUnitValue,
  isHighValueDrop,
  getLootTotalValue,
  hasHighValueLoot,
  isEpicLootValue,
  EPIC_LOOT_THRESHOLD,
} from '../src/utils/itemValue.js'

const items = {
  shrimps: { id: 'shrimps', shopValue: 5 },
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

describe('hasHighValueLoot (per-item purple trigger)', () => {
  it('is epic when at least one single item clears the threshold', () => {
    const loot = [
      { itemId: 'shrimps', quantity: 10 },
      { itemId: 'nether_demon_whip', quantity: 1 },
    ]
    expect(hasHighValueLoot(loot, items)).toBe(true)
  })

  it('is not epic when separate cheap items merely sum past 1m', () => {
    // 600k coins + 500k shrimps = 1.1m total, but no single item line is 1m+.
    const loot = [
      { itemId: 'coins', quantity: 600_000 },
      { itemId: 'shrimps', quantity: 100_000 },
    ]
    expect(getLootTotalValue(loot, items)).toBe(1_100_000)
    expect(hasHighValueLoot(loot, items)).toBe(false)
  })

  it('is epic when a single item stack clears the threshold via quantity', () => {
    // One item line worth 1.5m (already shown as a highlighted row).
    const loot = [{ itemId: 'shrimps', quantity: 300_000 }]
    expect(hasHighValueLoot(loot, items)).toBe(true)
  })

  it('accepts an { itemId: quantity } map and handles empty loot', () => {
    expect(hasHighValueLoot({ nether_demon_whip: 1 }, items)).toBe(true)
    expect(hasHighValueLoot({ shrimps: 5 }, items)).toBe(false)
    expect(hasHighValueLoot(null, items)).toBe(false)
    expect(hasHighValueLoot([], items)).toBe(false)
  })
})
