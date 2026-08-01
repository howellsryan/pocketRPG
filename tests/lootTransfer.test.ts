// PvP loot valuation and bank-filling, tested in isolation so the world's
// death path and the bot loot box can trust the math.

import { describe, it, expect } from 'vitest'
import {
  isPvpCoinReplacementItem,
  fillBank,
  lootEntryValue,
} from '../src/engine/lootTransfer.js'

// Minimal items lookup. Only the fields lootTransfer reads are present.
const items = {
  coins:            { id: 'coins',            isUntradeable: true,  stackable: true,  shopValue: 1 },
  shrimps:           { id: 'shrimps',           isUntradeable: false,                  shopValue: 5 },
  runeforged_scimitar:    { id: 'runeforged_scimitar',    isUntradeable: false,                  shopValue: 25_000 },
  nether_demon_whip:     { id: 'nether_demon_whip',     isUntradeable: false,                  shopValue: 1_500_000 },
  fire_cape:        { id: 'fire_cape',        isUntradeable: true,                   shopValue: 0 },
  venom_blowpipe:   { id: 'venom_blowpipe',   isUntradeable: false,                  shopValue: 4_500_000 },
  dragon_arrow:     { id: 'dragon_arrow',     isUntradeable: false, stackable: true, shopValue: 1500 },
  venomcoil_scales:    { id: 'venomcoil_scales',    isUntradeable: false, stackable: true, shopValue: 200 },
  boss_blade:       { id: 'boss_blade',       isUntradeable: false, isBossUnique: true, shopValue: 1_000_000 },
  boss_relic:       { id: 'boss_relic',       isUntradeable: true,  isBossUnique: true, shopValue: 2_500_000 },
  clue_scroll_gold: { id: 'clue_scroll_gold', isUntradeable: false, isClueReward: true, shopValue: 250_000, stackable: true },
  dragon_defender:  { id: 'dragon_defender',  isUntradeable: true, shopValue: 1 },
}


describe('isPvpCoinReplacementItem', () => {
  it('returns true for untradeables only, false for coins/tradeables', () => {
    expect(isPvpCoinReplacementItem('fire_cape', items)).toBe(true)
    expect(isPvpCoinReplacementItem('boss_relic', items)).toBe(true)
    expect(isPvpCoinReplacementItem('coins', items)).toBe(false)
  })
})


describe('lootEntryValue (bot-win risk value)', () => {
  it('returns coins quantity directly', () => {
    expect(lootEntryValue({ itemId: 'coins', quantity: 5000 }, items)).toBe(5000)
  })

  it('multiplies shopValue by quantity for non-coin items', () => {
    expect(lootEntryValue({ itemId: 'dragon_arrow', quantity: 100 }, items)).toBe(150_000)
  })

  it('values a single high-worth item by its shopValue, not its stack count', () => {
    // Regression: the bot-win risk summary used to sum item *quantities*,
    // so a 1.5M whip reported as "1". It must report its coin value.
    expect(lootEntryValue({ itemId: 'nether_demon_whip', quantity: 1 }, items)).toBe(1_500_000)
  })

  it('summing a loot pile yields true gold value, stacks multiplied', () => {
    const pile = [
      { itemId: 'nether_demon_whip', quantity: 1 },
      { itemId: 'dragon_arrow', quantity: 200 },
    ]
    const totalRiskValue = pile.reduce((s, e) => s + lootEntryValue(e, items), 0)
    expect(totalRiskValue).toBe(1_500_000 + 200 * 1500)
  })
})


describe('fillBank', () => {
  it('adds new itemIds when there is room', () => {
    const result = fillBank({}, [{ itemId: 'shrimps', quantity: 5 }], items)
    expect(result.added).toHaveLength(1)
    expect(result.dropped).toHaveLength(0)
    expect(result.bank.shrimps).toEqual({ itemId: 'shrimps', quantity: 5 })
  })

  it('merges stackable items into existing entries', () => {
    const initial = { coins: { itemId: 'coins', quantity: 1000 } }
    const result = fillBank(initial, [{ itemId: 'coins', quantity: 500 }], items)
    expect(result.bank.coins.quantity).toBe(1500)
    expect(result.added).toHaveLength(1)
  })

  it('drops items when bank is at BANK_SIZE cap and the itemId is new', () => {
    // Synthetic items list with BANK_SIZE filler entries
    const filler: Record<string, { itemId: string; quantity: number }> = {}
    for (let i = 0; i < 500; i++) filler[`junk_${i}`] = { itemId: `junk_${i}`, quantity: 1 }
    const result = fillBank(filler, [{ itemId: 'runeforged_scimitar', quantity: 1 }], items, 500)
    expect(result.added).toHaveLength(0)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0].itemId).toBe('runeforged_scimitar')
    expect(result.addedValue).toBe(0)
    expect(result.droppedValue).toBe(25_000)
  })

  it('drops non-stackable charges-collision rather than silently merging', () => {
    const initial = { venom_blowpipe: { itemId: 'venom_blowpipe', quantity: 1, charges: 5000 } }
    const result = fillBank(initial, [{ itemId: 'venom_blowpipe', quantity: 1, charges: 8000 }], items)
    expect(result.added).toHaveLength(0)
    expect(result.dropped).toHaveLength(1)
    // Existing entry must be untouched (charges preserved)
    expect(result.bank.venom_blowpipe.charges).toBe(5000)
  })

  it('totals droppedValue across multiple discarded items', () => {
    // Bank full
    const filler: Record<string, { itemId: string; quantity: number }> = {}
    for (let i = 0; i < 500; i++) filler[`j_${i}`] = { itemId: `j_${i}`, quantity: 1 }
    const result = fillBank(filler, [
      { itemId: 'runeforged_scimitar', quantity: 1 },   // 25,000
      { itemId: 'nether_demon_whip', quantity: 1 },    // 1,500,000
    ], items, 500)
    expect(result.dropped).toHaveLength(2)
    expect(result.addedValue).toBe(0)
    expect(result.droppedValue).toBe(1_525_000)
  })

  it('always credits coins even when bank is full and coins key is missing', () => {
    const filler: Record<string, { itemId: string; quantity: number }> = {}
    for (let i = 0; i < 500; i++) filler[`j_${i}`] = { itemId: `j_${i}`, quantity: 1 }
    const result = fillBank(filler, [{ itemId: 'coins', quantity: 1_000_000 }], items, 500)
    expect(result.bank.coins.quantity).toBe(1_000_000)
    expect(result.dropped).toHaveLength(0)
  })
})

