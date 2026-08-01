// The item-loss detector (Phase 2 of the item-loss safety net). These are the
// cases the OLD guard (detectBankWipe) is blind to — half a bank, and a stack
// collapsing to nothing — plus the legitimate bulk paths that must never look
// like loss.
import { describe, it, expect } from 'vitest'
import {
  classifyItemLoss,
  classifyItemLossFromHoldings,
  holdingsOf,
  isResourceItem,
  rememberHoldingsBaseline,
  readHoldingsBaseline,
  summariseHoldings,
} from '../functions/_lib/game/holdingsDelta.js'
import { detectBankWipe } from '../functions/_lib/game/saveValidation.js'

// Real ids so the items.json-driven classification and shopValue are exercised.
const DURABLES = [
  'runeforged_platebody', 'runeforged_platelegs', 'runeforged_full_helm', 'runeforged_kiteshield',
  'runeforged_scimitar', 'dragon_dagger', 'dragon_scimitar', 'nether_demon_whip',
  'bronze_platebody', 'iron_platebody', 'steel_platebody', 'mithril_platebody',
  'adamant_platebody', 'leather_body', 'studded_body', 'dragon_boots',
  'bronze_dagger', 'iron_dagger', 'steel_dagger', 'mithril_dagger',
]

function bankOf(ids: string[], quantity = 1) {
  const bank: Record<string, { itemId: string; quantity: number }> = {}
  for (const id of ids) bank[id] = { itemId: id, quantity }
  return bank
}

describe('holdingsOf', () => {
  it('counts bank, inventory and equipment as one set', () => {
    const { units } = holdingsOf({
      bank: { air_rune: { itemId: 'air_rune', quantity: 500 } },
      inventory: [{ itemId: 'air_rune', quantity: 100 }, null, { itemId: 'shrimps', quantity: 3 }],
      equipment: { weapon: { itemId: 'runeforged_scimitar' } },
    })
    expect(units.get('air_rune')).toBe(600)
    expect(units.get('shrimps')).toBe(3)
    expect(units.get('runeforged_scimitar')).toBe(1)
  })

  it('counts an equipped ammo stack by its quantity, and a worn piece as one', () => {
    const { units } = holdingsOf({
      equipment: { ammo: { itemId: 'runeforged_arrow', quantity: 750 }, body: { itemId: 'runeforged_platebody' } },
    })
    expect(units.get('runeforged_arrow')).toBe(750)
    expect(units.get('runeforged_platebody')).toBe(1)
  })

  it('reads a bare-number bank entry and pools charges per item', () => {
    const { units, charges } = holdingsOf({
      bank: { air_rune: 40, trident_of_venom: { itemId: 'trident_of_venom', quantity: 1, charges: 2500 } },
      inventory: [{ itemId: 'trident_of_venom', quantity: 1, charges: 100 }],
    })
    expect(units.get('air_rune')).toBe(40)
    expect(charges.get('trident_of_venom')).toBe(2600)
  })

  it('does not mutate the save it measures', () => {
    // getInventory() normalises in place; a detector must not, or the "before"
    // it is comparing against is edited by the act of reading it.
    const save = { inventory: [null, { itemId: 'shrimps', quantity: 0 }, { id: 'coins', quantity: 5 }] }
    const snapshot = JSON.stringify(save)
    holdingsOf(save)
    expect(JSON.stringify(save)).toBe(snapshot)
  })
})

describe('classifyItemLoss', () => {
  it('flags half a bank vanishing — the case detectBankWipe cannot see', () => {
    const previous = { bank: bankOf(DURABLES) }
    const next = { bank: bankOf(DURABLES.slice(0, 10)), inventory: [], equipment: {} }

    expect(detectBankWipe(previous, next).wiped).toBe(false)

    const loss = classifyItemLoss(previous, next)
    expect(loss.flagged).toBe(true)
    expect(loss.reasons).toContain('durable_items')
    expect(loss.durableUnits).toBe(10)
  })

  it('flags a resource stack collapsing to nothing — invisible to an id-count guard', () => {
    const previous = { bank: { death_rune: { itemId: 'death_rune', quantity: 200_000 } } }
    const next = { bank: {}, inventory: [], equipment: {} }

    // One distinct id, so the old guard's 15-item floor never engages.
    expect(detectBankWipe(previous, next).wiped).toBe(false)

    const loss = classifyItemLoss(previous, next)
    expect(loss.flagged).toBe(true)
    expect(loss.reasons).toContain('resource_value')
    expect(loss.resourceUnits).toBe(200_000)
  })

  it('sees no loss when the whole bank is withdrawn into inventory and equipment', () => {
    const previous = { bank: bankOf(DURABLES) }
    const next = {
      bank: {},
      inventory: DURABLES.slice(1).map((id) => ({ itemId: id, quantity: 1 })),
      equipment: { body: { itemId: DURABLES[0] } },
    }
    const loss = classifyItemLoss(previous, next)
    expect(loss.flagged).toBe(false)
    expect(loss.durableUnits).toBe(0)
  })

  it('shrugs at a day of idle catch-up burning supplies', () => {
    const previous = {
      bank: {
        shrimps: { itemId: 'shrimps', quantity: 4000 },
        air_rune: { itemId: 'air_rune', quantity: 60_000 },
        bronze_arrow: { itemId: 'bronze_arrow', quantity: 20_000 },
      },
    }
    const next = {
      bank: {
        shrimps: { itemId: 'shrimps', quantity: 500 },
        air_rune: { itemId: 'air_rune', quantity: 12_000 },
        bronze_arrow: { itemId: 'bronze_arrow', quantity: 2_000 },
      },
    }
    const loss = classifyItemLoss(previous, next)
    expect(loss.resourceUnits).toBeGreaterThan(60_000)
    expect(loss.flagged).toBe(false)
  })

  it('shrugs at a shop sell-off of a few cheap durables', () => {
    const previous = { bank: bankOf(['bronze_platebody', 'iron_platebody', 'steel_platebody']) }
    const next = { bank: {}, inventory: [], equipment: {} }
    expect(classifyItemLoss(previous, next).flagged).toBe(false)
  })

  it('flags two durables when they are worth real money', () => {
    const previous = { bank: bankOf(['nether_demon_whip', 'dragon_scimitar']) }
    const next = { bank: {}, inventory: [], equipment: {} }
    const loss = classifyItemLoss(previous, next)
    expect(loss.durableUnits).toBe(2)
    expect(loss.durableValue).toBeGreaterThanOrEqual(50_000)
    expect(loss.flagged).toBe(true)
  })

  it('counts coins and charges as their own scalars, never as item value', () => {
    const previous = {
      bank: {
        coins: { itemId: 'coins', quantity: 5_000_000 },
        trident_of_venom: { itemId: 'trident_of_venom', quantity: 1, charges: 2500 },
      },
    }
    const next = {
      bank: {
        coins: { itemId: 'coins', quantity: 1_000_000 },
        trident_of_venom: { itemId: 'trident_of_venom', quantity: 1, charges: 0 },
      },
    }
    const loss = classifyItemLoss(previous, next)
    expect(loss.coinsLost).toBe(4_000_000)
    expect(loss.chargesLost).toBe(2500)
    expect(loss.resourceValue).toBe(0)
    // A big purchase is not an item-loss incident.
    expect(loss.flagged).toBe(false)
  })

  it('treats a legacy id and its canonical id as the same item', () => {
    const previous = { bank: { rune_scimitar: { itemId: 'rune_scimitar', quantity: 1 } } }
    const next = { bank: { runeforged_scimitar: { itemId: 'runeforged_scimitar', quantity: 1 } } }
    expect(classifyItemLoss(previous, next).durableUnits).toBe(0)
  })

  it('reports the biggest losses first and caps the list', () => {
    const previous = { bank: bankOf(DURABLES) }
    const next = { bank: {}, inventory: [], equipment: {} }
    const loss = classifyItemLoss(previous, next)
    expect(loss.distinctItemsLost).toBe(DURABLES.length)
    expect(loss.items).toHaveLength(12)
    expect(loss.items[0].value).toBeGreaterThanOrEqual(loss.items[11].value)
  })

  it('classifies by items.json type, not stackability', () => {
    // Food and materials are non-stackable but bulk-consumed; runes and ammo
    // are stackable consumables. Both would land on the wrong side of a
    // `stackable` axis.
    expect(isResourceItem('shrimps')).toBe(true)
    expect(isResourceItem('air_rune')).toBe(true)
    expect(isResourceItem('bronze_arrow')).toBe(true)
    expect(isResourceItem('runeforged_platebody')).toBe(false)
    expect(isResourceItem('nether_demon_whip')).toBe(false)
  })

  it('falls back to the coarse axis for an item id we no longer ship', () => {
    const previous = { bank: { removed_relic: { itemId: 'removed_relic', quantity: 9 } } }
    const next = { bank: {} }
    // Unknown → not equippable, not stackable → durable, and 9 units clears the
    // bulk floor even at zero value.
    expect(classifyItemLoss(previous, next).flagged).toBe(true)
  })
})

describe('holdings baselines', () => {
  it('remembers the holdings as they were, not a reference that mutates', () => {
    const save: any = { bank: { air_rune: { itemId: 'air_rune', quantity: 100 } } }
    rememberHoldingsBaseline(save)
    // The writer mutates the loaded save in place — a reference-based baseline
    // would read back the post-mutation state and report zero loss.
    save.bank = {}
    const baseline = readHoldingsBaseline(save)!
    expect(baseline.units.get('air_rune')).toBe(100)
    expect(classifyItemLossFromHoldings(baseline, save).resourceUnits).toBe(100)
  })

  it('has no baseline for a save it never saw', () => {
    expect(readHoldingsBaseline({ bank: {} })).toBeNull()
    expect(readHoldingsBaseline(null)).toBeNull()
  })
})

describe('summariseHoldings', () => {
  it('orders by value so the question "is my whip in this one" is answerable', () => {
    const summary = summariseHoldings({
      bank: bankOf(['nether_demon_whip', 'bronze_dagger']),
      inventory: [{ itemId: 'air_rune', quantity: 50 }],
    })
    expect(summary.distinctItems).toBe(3)
    expect(summary.totalUnits).toBe(52)
    expect(summary.topItems[0].itemId).toBe('nether_demon_whip')
  })
})
