// Loot transfer rules — tested in isolation so Phase 4's UI layer can
// trust the math. The engine doesn't run here; we only exercise the
// pure splitInventoryByTradeable / sortLootByValueDesc / fillBank /
// applyLootTransfer helpers.

import { describe, it, expect } from 'vitest'
import {
  isPvpTradeable,
  isPvpCoinReplacementItem,
  splitInventoryByTradeable,
  sortLootByValueDesc,
  fillBank,
  applyLootTransfer,
} from '../src/engine/lootTransfer.js'

// Minimal items lookup. Only the fields lootTransfer reads are present.
const items = {
  coins:            { id: 'coins',            isUntradeable: true,  stackable: true,  shopValue: 1 },
  shrimp:           { id: 'shrimp',           isUntradeable: false,                  shopValue: 5 },
  rune_scimitar:    { id: 'rune_scimitar',    isUntradeable: false,                  shopValue: 25_000 },
  abyssal_whip:     { id: 'abyssal_whip',     isUntradeable: false,                  shopValue: 1_500_000 },
  fire_cape:        { id: 'fire_cape',        isUntradeable: true,                   shopValue: 0 },
  toxic_blowpipe:   { id: 'toxic_blowpipe',   isUntradeable: false,                  shopValue: 4_500_000 },
  dragon_arrow:     { id: 'dragon_arrow',     isUntradeable: false, stackable: true, shopValue: 1500 },
  zulrah_scales:    { id: 'zulrah_scales',    isUntradeable: false, stackable: true, shopValue: 200 },
  boss_blade:       { id: 'boss_blade',       isUntradeable: false, isBossUnique: true, shopValue: 1_000_000 },
  boss_relic:       { id: 'boss_relic',       isUntradeable: true,  isBossUnique: true, shopValue: 2_500_000 },
  clue_scroll_gold: { id: 'clue_scroll_gold', isUntradeable: false, isClueReward: true, shopValue: 250_000, stackable: true },
  dragon_defender:  { id: 'dragon_defender',  isUntradeable: true, shopValue: 1 },
}

describe('isPvpTradeable', () => {
  it('coins always transfer despite items.json untradeable flag', () => {
    expect(items.coins.isUntradeable).toBe(true)
    expect(isPvpTradeable('coins', items)).toBe(true)
  })
  it('returns false for fire cape (untradeable, not coins)', () => {
    expect(isPvpTradeable('fire_cape', items)).toBe(false)
  })
  it('returns true for normal tradeable gear', () => {
    expect(isPvpTradeable('rune_scimitar', items)).toBe(true)
    expect(isPvpTradeable('shrimp', items)).toBe(true)
  })
  it('returns false for unknown items (defensive)', () => {
    expect(isPvpTradeable('not_a_real_item', items)).toBe(false)
  })
})

describe('isPvpCoinReplacementItem', () => {
  it('returns true for untradeables only, false for coins/tradeables', () => {
    expect(isPvpCoinReplacementItem('fire_cape', items)).toBe(true)
    expect(isPvpCoinReplacementItem('boss_relic', items)).toBe(true)
    expect(isPvpCoinReplacementItem('coins', items)).toBe(false)
  })
})

describe('splitInventoryByTradeable', () => {
  it('moves equipped tradeables to transfer pile, clears those slots', () => {
    const equipment = { weapon: { itemId: 'abyssal_whip' }, cape: null }
    const { transfer, remainingEquipment } = splitInventoryByTradeable([], equipment, items)
    expect(transfer.map(t => t.itemId)).toContain('abyssal_whip')
    expect(remainingEquipment.weapon).toBeNull()
  })

  it('converts equipped untradeables into coins and clears loser slot', () => {
    const equipment = { weapon: null, cape: { itemId: 'fire_cape' } }
    const { transfer, remainingEquipment, remainingInventory } =
      splitInventoryByTradeable(new Array(28).fill(null), equipment, items)
    expect(transfer).toHaveLength(1)
    expect(transfer[0].itemId).toBe('coins')
    expect(remainingEquipment.cape).toBeNull()
    expect(remainingInventory.every(s => s === null)).toBe(true)
  })

  it('converts untradeable inventory items into coins', () => {
    const inv = new Array(28).fill(null)
    inv[5] = { itemId: 'fire_cape', quantity: 1 }
    inv[10] = { itemId: 'shrimp', quantity: 3 }
    const { transfer, remainingInventory } = splitInventoryByTradeable(inv, {}, items)
    expect(transfer.length).toBe(2)
    expect(transfer.some(t => t.itemId === 'shrimp')).toBe(true)
    expect(transfer.some(t => t.itemId === 'coins')).toBe(true)
    expect(remainingInventory[5]).toBeNull()
    expect(remainingInventory[10]).toBeNull()
  })

  it('coins always transfer even from inventory', () => {
    const inv = new Array(28).fill(null)
    inv[0] = { itemId: 'coins', quantity: 4_500_000 }
    const { transfer, remainingInventory } = splitInventoryByTradeable(inv, {}, items)
    expect(transfer).toHaveLength(1)
    expect(transfer[0].itemId).toBe('coins')
    expect(transfer[0].quantity).toBe(4_500_000)
    expect(remainingInventory[0]).toBeNull()
  })

  it('preserves charges on equipped scale-charged weapons', () => {
    const equipment = { weapon: { itemId: 'toxic_blowpipe', charges: 8000 } }
    const { transfer } = splitInventoryByTradeable([], equipment, items)
    expect(transfer[0].itemId).toBe('toxic_blowpipe')
    expect(transfer[0].charges).toBe(8000)
  })

  it('preserves ammo quantity carried on equipment.ammo', () => {
    const equipment = { ammo: { itemId: 'dragon_arrow', quantity: 850 } }
    const { transfer } = splitInventoryByTradeable([], equipment, items)
    expect(transfer[0].itemId).toBe('dragon_arrow')
    expect(transfer[0].quantity).toBe(850)
  })

  it('transfers equipped tradeable boss unique item directly and clears loser slot', () => {
    const equipment = { weapon: { itemId: 'boss_blade' } }
    const { transfer, remainingEquipment } = splitInventoryByTradeable([], equipment, items)
    expect(transfer).toHaveLength(1)
    expect(transfer[0]).toMatchObject({ itemId: 'boss_blade', quantity: 1, fromSlot: 'equipment.weapon' })
    expect(remainingEquipment.weapon).toBeNull()
  })
})

describe('sortLootByValueDesc', () => {
  it('places highest shopValue first; missing values sort to end', () => {
    const pile = [
      { itemId: 'shrimp', quantity: 1 },
      { itemId: 'abyssal_whip', quantity: 1 },
      { itemId: 'rune_scimitar', quantity: 1 },
      { itemId: 'fire_cape', quantity: 1 },          // shopValue 0
      { itemId: 'unknown', quantity: 1 },             // missing → 0
    ]
    const sorted = sortLootByValueDesc(pile, items)
    expect(sorted[0].itemId).toBe('abyssal_whip')
    expect(sorted[1].itemId).toBe('rune_scimitar')
    expect(sorted[2].itemId).toBe('shrimp')
    // last two are 0-value items, order between them isn't important
  })
})

describe('fillBank', () => {
  it('adds new itemIds when there is room', () => {
    const result = fillBank({}, [{ itemId: 'shrimp', quantity: 5 }], items)
    expect(result.added).toHaveLength(1)
    expect(result.dropped).toHaveLength(0)
    expect(result.bank.shrimp).toEqual({ itemId: 'shrimp', quantity: 5 })
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
    const result = fillBank(filler, [{ itemId: 'rune_scimitar', quantity: 1 }], items, 500)
    expect(result.added).toHaveLength(0)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0].itemId).toBe('rune_scimitar')
    expect(result.addedValue).toBe(0)
    expect(result.droppedValue).toBe(25_000)
  })

  it('drops non-stackable charges-collision rather than silently merging', () => {
    const initial = { toxic_blowpipe: { itemId: 'toxic_blowpipe', quantity: 1, charges: 5000 } }
    const result = fillBank(initial, [{ itemId: 'toxic_blowpipe', quantity: 1, charges: 8000 }], items)
    expect(result.added).toHaveLength(0)
    expect(result.dropped).toHaveLength(1)
    // Existing entry must be untouched (charges preserved)
    expect(result.bank.toxic_blowpipe.charges).toBe(5000)
  })

  it('totals droppedValue across multiple discarded items', () => {
    // Bank full
    const filler: Record<string, { itemId: string; quantity: number }> = {}
    for (let i = 0; i < 500; i++) filler[`j_${i}`] = { itemId: `j_${i}`, quantity: 1 }
    const result = fillBank(filler, [
      { itemId: 'rune_scimitar', quantity: 1 },   // 25,000
      { itemId: 'abyssal_whip', quantity: 1 },    // 1,500,000
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

describe('applyLootTransfer (end-to-end)', () => {
  it('fully simulates a death: coins transfer, fire cape converts, whip + arrows transfer', () => {
    const loserInv = new Array(28).fill(null)
    loserInv[0] = { itemId: 'coins', quantity: 50_000 }
    loserInv[1] = { itemId: 'shrimp', quantity: 4 }
    const loserEq = {
      weapon: { itemId: 'abyssal_whip' },
      cape:   { itemId: 'fire_cape' },
      ammo:   { itemId: 'dragon_arrow', quantity: 200 },
    }
    const winnerBank = { coins: { itemId: 'coins', quantity: 1_000 } }

    const result = applyLootTransfer({
      loserInventory: loserInv,
      loserEquipment: loserEq,
      winnerBank,
      itemsData: items,
    })

    // Loser keeps fire cape equipped, loses everything else equipped/inventory
    expect(result.loser.equipment.cape).toBeNull()
    expect(result.loser.equipment.weapon).toBeNull()
    expect(result.loser.equipment.ammo).toBeNull()
    expect(result.loser.inventory.every(s => s === null)).toBe(true)

    // Winner's bank: coins merged to 51,000; whip and arrows added; no drops
    expect(result.winner.bank.coins.quantity).toBe(51_001)
    expect(result.winner.bank.abyssal_whip).toBeDefined()
    expect(result.winner.bank.dragon_arrow).toBeDefined()
    expect(result.winner.bank.dragon_arrow.quantity).toBe(200)
    expect(result.summary.dropped).toHaveLength(0)
    expect(result.summary.transferCount).toBe(5)
    expect(result.summary.bankedValue).toBe(1_850_021)
    expect(result.summary.addedValue).toBe(1_850_021)
    expect(result.summary.totalRiskValue).toBe(1_850_021)
    expect(result.summary.droppedValue).toBe(0)
  })

  it('reports overflow when winner bank is full', () => {
    const filler: Record<string, { itemId: string; quantity: number }> = {}
    for (let i = 0; i < 500; i++) filler[`x_${i}`] = { itemId: `x_${i}`, quantity: 1 }

    const loserEq = { weapon: { itemId: 'abyssal_whip' } }
    const result = applyLootTransfer({
      loserInventory: [],
      loserEquipment: loserEq,
      winnerBank: filler,
      itemsData: items,
    })

    expect(result.summary.added).toHaveLength(0)
    expect(result.summary.dropped).toHaveLength(1)
    expect(result.summary.bankedValue).toBe(0)
    expect(result.summary.totalRiskValue).toBe(1_500_000)
    expect(result.summary.droppedValue).toBe(1_500_000)
    expect(result.loser.equipment.weapon).toBeNull()    // loser still loses it
  })

  it('boss unique equipped item transfers original item', () => {
    const result = applyLootTransfer({
      loserInventory: new Array(28).fill(null),
      loserEquipment: { weapon: { itemId: 'boss_blade' } },
      winnerBank: {},
      itemsData: items,
    })
    expect(result.loser.equipment.weapon).toBeNull()
    expect(result.winner.bank.boss_blade.quantity).toBe(1)
    expect(result.summary.added.some(i => i.itemId === 'boss_blade')).toBe(true)
    expect(result.summary.bankedValue).toBe(1_000_000)
  })

  it('boss unique untradeable item still converts to coins', () => {
    const inv = new Array(28).fill(null)
    inv[3] = { itemId: 'boss_relic', quantity: 1 }
    const result = applyLootTransfer({
      loserInventory: inv,
      loserEquipment: {},
      winnerBank: {},
      itemsData: items,
    })
    expect(result.loser.inventory[3]).toBeNull()
    expect(result.winner.bank.coins.quantity).toBe(2_500_000)
    expect(result.winner.bank.boss_relic).toBeUndefined()
  })


  it('minigame unlock untradeable item uses fixed 4.5m conversion value', () => {
    const inv = new Array(28).fill(null)
    inv[3] = { itemId: 'dragon_defender', quantity: 1 }
    const result = applyLootTransfer({
      loserInventory: inv,
      loserEquipment: {},
      winnerBank: {},
      itemsData: items,
    })
    expect(result.loser.inventory[3]).toBeNull()
    expect(result.winner.bank.coins.quantity).toBe(4_500_000)
  })

  it('clue reward quantity transfers as item', () => {
    const inv = new Array(28).fill(null)
    inv[1] = { itemId: 'clue_scroll_gold', quantity: 3 }
    const result = applyLootTransfer({
      loserInventory: inv,
      loserEquipment: {},
      winnerBank: {},
      itemsData: items,
    })
    expect(result.loser.inventory[1]).toBeNull()
    expect(result.winner.bank.clue_scroll_gold.quantity).toBe(3)
  })

  it('mixed death pile converts untradeables and transfers boss/clue normally', () => {
    const inv = new Array(28).fill(null)
    inv[0] = { itemId: 'coins', quantity: 10_000 }
    inv[1] = { itemId: 'rune_scimitar', quantity: 1 }
    inv[2] = { itemId: 'fire_cape', quantity: 1 }
    inv[3] = { itemId: 'clue_scroll_gold', quantity: 1 }
    const eq = { weapon: { itemId: 'boss_blade' } }
    const result = applyLootTransfer({
      loserInventory: inv,
      loserEquipment: eq,
      winnerBank: {},
      itemsData: items,
    })
    expect(result.loser.inventory[2]).toBeNull()
    expect(result.loser.inventory[0]).toBeNull()
    expect(result.loser.inventory[1]).toBeNull()
    expect(result.loser.inventory[3]).toBeNull()
    expect(result.loser.equipment.weapon).toBeNull()
    expect(result.winner.bank.rune_scimitar).toBeDefined()
    expect(result.winner.bank.coins.quantity).toBe(10_001)
    expect(result.summary.added.some(i => i.itemId === 'boss_blade')).toBe(true)
    expect(result.summary.added.some(i => i.itemId === 'clue_scroll_gold')).toBe(true)
  })

  it('adds replacement coins for every untradeable item in the death pile (not just one)', () => {
    const inv = new Array(28).fill(null)
    inv[0] = { itemId: 'boss_relic', quantity: 1 }         // 2,500,000
    inv[1] = { itemId: 'clue_scroll_gold', quantity: 2 }   // 500,000
    inv[2] = { itemId: 'clue_scroll_gold', quantity: 1 }   // 250,000
    const eq = {
      weapon: { itemId: 'boss_blade', quantity: 1 },       // 1,000,000
    }

    const result = applyLootTransfer({
      loserInventory: inv,
      loserEquipment: eq,
      winnerBank: {},
      itemsData: items,
    })

    expect(result.loser.inventory[0]).toBeNull()
    expect(result.loser.inventory[1]).toBeNull()
    expect(result.loser.inventory[2]).toBeNull()
    expect(result.loser.equipment.weapon).toBeNull()
    expect(result.winner.bank.coins.quantity).toBe(2_500_000)
    expect(result.summary.bankedValue).toBe(4_250_000)
    expect(result.summary.totalRiskValue).toBe(4_250_000)
    expect(result.summary.added.some(i => i.itemId === 'coins')).toBe(true)
  })
})
