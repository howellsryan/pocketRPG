// The item-loss detector (Phase 2 of the item-loss safety net). These are the
// cases the OLD guard (detectBankWipe) is blind to — half a bank, and a stack
// collapsing to nothing — plus the legitimate bulk paths that must never look
// like loss.
import { describe, it, expect } from 'vitest'
import {
  classifyItemLoss,
  classifyItemLossFromHoldings,
  declareItemLosses,
  holdingsOf,
  mergeDeclaredLosses,
  readDeclaredLosses,
  sanitiseDeclaredLosses,
  isResourceItem,
  rememberHoldingsBaseline,
  readHoldingsBaseline,
  summariseHoldings,
} from '../functions/_lib/game/holdingsDelta.js'
import { detectBankWipe } from '../functions/_lib/game/saveValidation.js'
import itemsJson from '../src/data/items.json'

const itemsTableForLegacyProbe = () => itemsJson as any

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

// ── Declared losses (Phase 3) ──────────────────────────────────────────────
// Production idling spends recipe inputs by the thousand. Every one of the 15
// real incidents this feature was built from was a summoning infusion — equal
// counts of empty_pouch, blue_charm and steel_platebody, the last of which is
// `type: armour` and therefore DURABLE — so ordinary crafting flagged on
// essentially every save and buried the flags worth reading.
describe('declared losses', () => {
  const infusionBefore = {
    bank: {
      empty_pouch: { itemId: 'empty_pouch', quantity: 1000 },
      blue_charm: { itemId: 'blue_charm', quantity: 1000 },
      steel_platebody: { itemId: 'steel_platebody', quantity: 1000 },
    },
  }
  const infusionAfter = {
    bank: {
      empty_pouch: { itemId: 'empty_pouch', quantity: 800 },
      blue_charm: { itemId: 'blue_charm', quantity: 800 },
      steel_platebody: { itemId: 'steel_platebody', quantity: 800 },
      steel_titan_pouch: { itemId: 'steel_titan_pouch', quantity: 200 },
    },
  }
  const infusionDeclared = { empty_pouch: 200, blue_charm: 200, steel_platebody: 200 }

  it('flags an infusion that declares nothing', () => {
    const loss = classifyItemLoss(infusionBefore, infusionAfter)
    expect(loss.flagged).toBe(true)
    expect(loss.reasons).toContain('durable_items')
  })

  it('does not flag the same infusion once declared', () => {
    const loss = classifyItemLoss(infusionBefore, infusionAfter, undefined, infusionDeclared)
    expect(loss.flagged).toBe(false)
    expect(loss.durableUnits).toBe(0)
    expect(loss.resourceUnits).toBe(0)
    expect(loss.declaredUnits).toBe(600)
  })

  it('still flags what the declaration does not cover', () => {
    // Declares its materials honestly, but a bug eats the bank's gear alongside.
    const before = {
      bank: {
        ...infusionBefore.bank,
        ...bankOf(DURABLES.slice(0, 8)),
      },
    }
    const after = { bank: { ...infusionAfter.bank } }
    const loss = classifyItemLoss(before, after, undefined, infusionDeclared)
    expect(loss.flagged).toBe(true)
    expect(loss.durableUnits).toBe(8)
    expect(loss.items.some((i: any) => i.itemId === 'steel_platebody')).toBe(false)
  })

  // The netting is per item and clamped at zero. Without that, one wildly
  // over-declared line would absorb every other item's disappearance.
  it('cannot let an over-declaration of one item cover another', () => {
    const before = { bank: { ...bankOf(DURABLES.slice(0, 6)), empty_pouch: { itemId: 'empty_pouch', quantity: 10 } } }
    const after = { bank: {} }
    const loss = classifyItemLoss(before, after, undefined, { empty_pouch: 1_000_000 })
    expect(loss.flagged).toBe(true)
    expect(loss.durableUnits).toBe(6)
    expect(loss.declaredUnits).toBe(10)
  })

  it('ignores a malformed or negative declaration rather than trusting it', () => {
    const loss = classifyItemLoss(infusionBefore, infusionAfter, undefined, {
      empty_pouch: -500, blue_charm: 'lots', steel_platebody: null,
    } as any)
    expect(loss.declaredUnits).toBe(0)
    expect(loss.flagged).toBe(true)
  })

  it('canonicalises a declaration made under a legacy item id', () => {
    const legacy = Object.values(itemsTableForLegacyProbe()).find((i: any) => i.legacy_item_id && i.legacy_item_id !== i.id) as any
    const before = { bank: { [legacy.id]: { itemId: legacy.id, quantity: 20 } } }
    const after = { bank: {} }
    const undeclared = classifyItemLoss(before, after)
    const declared = classifyItemLoss(before, after, undefined, { [legacy.legacy_item_id]: 20 })
    expect(declared.declaredUnits).toBe(20)
    expect(declared.durableUnits + declared.resourceUnits)
      .toBeLessThan(undeclared.durableUnits + undeclared.resourceUnits)
  })

  it('accepts a pre-built Map without silently declaring nothing', () => {
    const loss = classifyItemLoss(infusionBefore, infusionAfter, undefined,
      sanitiseDeclaredLosses(infusionDeclared) as any)
    expect(loss.flagged).toBe(false)
    expect(loss.declaredUnits).toBe(600)
  })

  it('nets a declaration through classifyItemLossFromHoldings too', () => {
    const loss = classifyItemLossFromHoldings(holdingsOf(infusionBefore), infusionAfter, undefined, infusionDeclared)
    expect(loss.flagged).toBe(false)
  })
})

describe('declared-loss ledgers carried on the save object', () => {
  it('reads back what a server-side mutation declared', () => {
    const save: any = { bank: {} }
    declareItemLosses(save, { empty_pouch: 5 })
    declareItemLosses(save, { empty_pouch: 3, blue_charm: 2 })
    expect(readDeclaredLosses(save)).toEqual({ empty_pouch: 8, blue_charm: 2 })
  })

  it('declares nothing for a save nothing was recorded against', () => {
    expect(readDeclaredLosses({ bank: {} })).toBeNull()
  })

  it('merges an explicit declaration with the carried one', () => {
    expect(mergeDeclaredLosses({ a: 1 }, { a: 2, b: 3 })).toEqual({ a: 3, b: 3 })
    expect(mergeDeclaredLosses(null, { a: 1 })).toEqual({ a: 1 })
    expect(mergeDeclaredLosses({ a: 1 }, null)).toEqual({ a: 1 })
    expect(mergeDeclaredLosses(null, null)).toBeNull()
  })
})
