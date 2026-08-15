// Post-kill loot modal shaping, shared by the solo and co-op fights. The
// spotlight rule is the one worth pinning: the rare drop headlines, not the
// biggest pile of coins.

import { describe, it, expect } from 'vitest'
import { shapeLootForModal, lootRowsForModal, killPresentsFullModal, killRevealRewards } from '../src/utils/lootModal.js'

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

// Which kills stop the game. A boss or a raid earns the full-screen takeover;
// everything else announces itself on a card and keeps fighting, so a slayer
// grind isn't a modal every ten seconds.
describe('killPresentsFullModal', () => {
  it('stops on a boss', () => {
    expect(killPresentsFullModal({ isBossKill: true, raidId: null })).toBe(true)
  })

  it('stops on a raid completion even though the final boss is the kill', () => {
    expect(killPresentsFullModal({ isBossKill: true, raidId: 'chambers' })).toBe(true)
    expect(killPresentsFullModal({ isBossKill: false, raidId: 'chambers' })).toBe(true)
  })

  it('lets an ordinary monster through', () => {
    expect(killPresentsFullModal({ isBossKill: false, raidId: null })).toBe(false)
  })

  it('lets a non-boss with a collection-logged drop through too — a gargoyle is a grind', () => {
    expect(killPresentsFullModal({ isBossKill: false, raidId: undefined })).toBe(false)
  })

  it('treats a missing flag as an ordinary kill rather than a takeover', () => {
    expect(killPresentsFullModal({})).toBe(false)
    expect(killPresentsFullModal()).toBe(false)
    expect(killPresentsFullModal({ isBossKill: 'yes' as any })).toBe(false)
  })
})

describe('killRevealRewards', () => {
  it('collapses a drop table that rolled the same item twice into one chip', () => {
    expect(killRevealRewards([
      { itemId: 'bones', quantity: 1 },
      { itemId: 'coins', quantity: 30 },
      { itemId: 'bones', quantity: 2 },
    ])).toEqual([
      { itemId: 'bones', quantity: 3 },
      { itemId: 'coins', quantity: 30 },
    ])
  })

  it('defaults a missing quantity to one', () => {
    expect(killRevealRewards([{ itemId: 'bones' }])).toEqual([{ itemId: 'bones', quantity: 1 }])
  })

  it('drops junk rather than rendering an empty chip', () => {
    expect(killRevealRewards([{ itemId: '', quantity: 5 }, { itemId: 'bones', quantity: 0 }, null as any])).toEqual([])
  })

  it('handles a kill that dropped nothing', () => {
    expect(killRevealRewards([])).toEqual([])
    expect(killRevealRewards(null as any)).toEqual([])
  })
})
