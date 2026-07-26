// Post-kill loot modal shaping, shared by the solo and co-op fights. The
// spotlight rule is the one worth pinning: the rare drop headlines, not the
// biggest pile of coins.

import { describe, it, expect } from 'vitest'
import { shapeLootForModal, lootRowsForModal } from '../src/utils/lootModal.js'

const itemsData = {
  coins: { name: 'Coins', shopValue: 1 },
  dragon_claws: { name: 'Dragon Claws', shopValue: 200_000 },
  shark: { name: 'Shark', shopValue: 800 },
  rune_bar: { name: 'Rune Bar', shopValue: 12_000 },
} as Record<string, { name: string; shopValue: number }>

describe('shapeLootForModal', () => {
  it('spotlights the rare drop over a bigger pile of coins', () => {
    const { hero, heroItem } = shapeLootForModal([
      { itemId: 'coins', quantity: 1_000_000 },
      { itemId: 'dragon_claws', quantity: 1 },
    ], itemsData)
    expect(hero?.itemId).toBe('dragon_claws')
    expect(heroItem?.name).toBe('Dragon Claws')
  })

  it('breaks a unit-value tie on total value', () => {
    const { hero } = shapeLootForModal([
      { itemId: 'shark', quantity: 1 },
      { itemId: 'shark', quantity: 10 },
    ], itemsData)
    expect(hero?.quantity).toBe(10)
  })

  it('orders the remaining loot by total value and leaves the hero out', () => {
    const { hero, rest } = shapeLootForModal([
      { itemId: 'coins', quantity: 50_000 },
      { itemId: 'dragon_claws', quantity: 1 },
      { itemId: 'shark', quantity: 3 },
    ], itemsData)
    expect(hero?.itemId).toBe('dragon_claws')
    expect(rest.map((d) => d.itemId)).toEqual(['coins', 'shark'])
  })

  it('totals every drop, hero included', () => {
    const { total } = shapeLootForModal([
      { itemId: 'coins', quantity: 500 },
      { itemId: 'rune_bar', quantity: 2 },
    ], itemsData)
    expect(total).toBe(500 + 24_000)
  })

  it('treats a missing quantity as one', () => {
    const { total } = shapeLootForModal([{ itemId: 'rune_bar' }], itemsData)
    expect(total).toBe(12_000)
  })

  it('survives an unknown item id rather than blanking the modal', () => {
    const { hero, heroItem, total } = shapeLootForModal([{ itemId: 'mystery_thing', quantity: 2 }], itemsData)
    expect(hero?.itemId).toBe('mystery_thing')
    expect(heroItem).toBeNull()
    expect(total).toBe(0)
  })

  it('handles a kill that dropped nothing', () => {
    expect(shapeLootForModal([], itemsData)).toMatchObject({ hero: null, heroItem: null, rest: [], total: 0 })
    expect(shapeLootForModal(null, itemsData).rest).toEqual([])
  })
})

describe('lootRowsForModal', () => {
  it('builds display rows, falling back to the id when the item is unknown', () => {
    const rows = lootRowsForModal([
      { itemId: 'shark', quantity: 3, unitGp: 800, totalGp: 2400 },
      { itemId: 'mystery_thing', quantity: 1, unitGp: 0, totalGp: 0 },
    ], itemsData)
    expect(rows[0]).toMatchObject({ name: 'Shark', quantity: 3, gp: 2400, unitGp: 800 })
    expect(rows[1]).toMatchObject({ name: 'mystery_thing', item: null })
    expect(rows.map((r) => r.key)).toEqual([0, 1])
  })

  it('returns nothing for an empty list', () => {
    expect(lootRowsForModal([], itemsData)).toEqual([])
    expect(lootRowsForModal(null, itemsData)).toEqual([])
  })
})
