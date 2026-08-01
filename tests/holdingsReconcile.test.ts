import { describe, it, expect } from 'vitest'
import {
  inventoryTotals,
  inventoryDelta,
  sameInventory,
  reconcileIdleInventory,
  applyIdleEquipmentWear,
  resolveIdleHoldingsWrites,
} from '../src/engine/holdingsReconcile.js'

const ITEMS: any = {
  shark: { id: 'shark', name: 'Shark' },
  air_rune: { id: 'air_rune', name: 'Air Rune', stackable: true },
  fire_rune: { id: 'fire_rune', name: 'Fire Rune', stackable: true },
  prayer_potion: { id: 'prayer_potion', name: 'Prayer Potion' },
  coal: { id: 'coal', name: 'Coal' },
  kodai_hat: { id: 'kodai_hat', name: 'Kodai Hat', slot: 'head' },
  trident: { id: 'trident', name: 'Trident', slot: 'weapon' },
  bronze_arrow: { id: 'bronze_arrow', name: 'Bronze Arrow', slot: 'ammo', stackable: true },
}

/** 28-slot inventory from a sparse index -> entry map. */
function inv(map: Record<number, any> = {}) {
  const arr: any[] = new Array(28).fill(null)
  for (const [i, v] of Object.entries(map)) arr[Number(i)] = v
  return arr
}

/** Every itemId held across all three containers, with totals. */
function heldTotals(equipment: any, inventory: any[], bank: any) {
  const totals: Record<string, number> = { ...inventoryTotals(inventory) }
  for (const slot of Object.keys(equipment || {})) {
    const e = equipment[slot]
    if (e?.itemId) totals[e.itemId] = (totals[e.itemId] || 0) + (e.quantity || 1)
  }
  for (const [id, entry] of Object.entries<any>(bank || {})) {
    const qty = Number(entry?.quantity) || 0
    if (qty > 0) totals[id] = (totals[id] || 0) + qty
  }
  return totals
}

describe('inventoryTotals / inventoryDelta', () => {
  it('sums a stackable item split across several slots', () => {
    const totals = inventoryTotals(inv({ 0: { itemId: 'air_rune', quantity: 100 }, 3: { itemId: 'air_rune', quantity: 50 } }))
    expect(totals.air_rune).toBe(150)
  })

  it('treats a slot with no quantity as one unit', () => {
    expect(inventoryTotals(inv({ 0: { itemId: 'shark' } })).shark).toBe(1)
  })

  it('reports gains as positive and consumption as negative, omitting no-change items', () => {
    const before = inv({ 0: { itemId: 'shark', quantity: 10 }, 1: { itemId: 'coal', quantity: 5 } })
    const after = inv({ 0: { itemId: 'shark', quantity: 4 }, 1: { itemId: 'coal', quantity: 5 }, 2: { itemId: 'air_rune', quantity: 20 } })
    expect(inventoryDelta(before, after)).toEqual({ shark: -6, air_rune: 20 })
  })
})

describe('sameInventory', () => {
  it('is true for identical packs and false when an item moves slot', () => {
    expect(sameInventory(inv({ 0: { itemId: 'shark', quantity: 1 } }), inv({ 0: { itemId: 'shark', quantity: 1 } }))).toBe(true)
    expect(sameInventory(inv({ 0: { itemId: 'shark', quantity: 1 } }), inv({ 1: { itemId: 'shark', quantity: 1 } }))).toBe(false)
  })

  it('is false when a stack size or noted flag differs', () => {
    expect(sameInventory(inv({ 0: { itemId: 'air_rune', quantity: 5 } }), inv({ 0: { itemId: 'air_rune', quantity: 6 } }))).toBe(false)
    expect(sameInventory(inv({ 0: { itemId: 'shark', quantity: 1 } }), inv({ 0: { itemId: 'shark', quantity: 1, noted: true } }))).toBe(false)
  })

  // A slot whose only difference is its charge value has still moved; calling it
  // unchanged takes the happy path and writes the snapshot's charges back.
  it('is false when only a charge value differs', () => {
    expect(sameInventory(
      inv({ 0: { itemId: 'trident', quantity: 1, charges: 2500 } }),
      inv({ 0: { itemId: 'trident', quantity: 1, charges: 900 } }),
    )).toBe(false)
  })

  it('ignores slots past the inventory cap', () => {
    const long = inv({ 0: { itemId: 'shark', quantity: 1 } })
    long.push({ itemId: 'coal', quantity: 5 })
    expect(sameInventory(long, inv({ 0: { itemId: 'shark', quantity: 1 } }))).toBe(true)
  })
})

describe('reconcileIdleInventory', () => {
  it('returns the simulated inventory untouched when nothing moved underneath it', () => {
    const base = inv({ 0: { itemId: 'shark', quantity: 10 } })
    const simulated = inv({ 0: { itemId: 'shark', quantity: 4 }, 1: { itemId: 'coal', quantity: 12 } })
    const out = reconcileIdleInventory({ base, simulated, live: inv({ 0: { itemId: 'shark', quantity: 10 } }), itemsData: ITEMS })
    expect(out.reconciled).toBe(false)
    expect(out.inventory).toBe(simulated)
    expect(out.overflow).toEqual({})
  })

  // The bug: the player swapped loadout after the snapshot the simulation ran
  // on was taken. Writing sim.finalInventory wholesale reverts that swap, and
  // because the bank keeps its removals the withdrawn kit exists nowhere.
  it('keeps items the player moved in after the simulation snapshot was taken', () => {
    const base = inv({ 0: { itemId: 'shark', quantity: 10 } })
    const simulated = inv({ 0: { itemId: 'shark', quantity: 4 }, 1: { itemId: 'coal', quantity: 12 } })
    // Loadout swap: sharks gone, a mage kit withdrawn from the bank in their place.
    const live = inv({ 0: { itemId: 'fire_rune', quantity: 1_500_000 }, 1: { itemId: 'prayer_potion', quantity: 1 } })

    const out = reconcileIdleInventory({ base, simulated, live, itemsData: ITEMS })

    expect(out.reconciled).toBe(true)
    const totals = inventoryTotals(out.inventory)
    expect(totals.fire_rune).toBe(1_500_000)
    expect(totals.prayer_potion).toBe(1)
    // The simulation's gain still lands, and its consumption is honoured only
    // as far as the live pack can pay it.
    expect(totals.coal).toBe(12)
    expect(totals.shark ?? 0).toBe(0)
  })

  it('applies consumption to the live pack rather than restoring the snapshot', () => {
    const base = inv({ 0: { itemId: 'shark', quantity: 10 } })
    const simulated = inv({ 0: { itemId: 'shark', quantity: 4 } })
    const live = inv({ 0: { itemId: 'shark', quantity: 20 }, 5: { itemId: 'coal', quantity: 3 } })

    const out = reconcileIdleInventory({ base, simulated, live, itemsData: ITEMS })

    expect(inventoryTotals(out.inventory).shark).toBe(14) // 20 live - 6 consumed
    expect(inventoryTotals(out.inventory).coal).toBe(3)   // untouched by the sim
  })

  // removeItem decrements quantity in place, and the live array's entry objects
  // are the ones React state still holds — reconciling must not reach into them.
  it('does not mutate the live inventory it was handed', () => {
    const base = inv({ 0: { itemId: 'shark', quantity: 10 } })
    const simulated = inv({ 0: { itemId: 'shark', quantity: 4 } })
    const live = inv({ 0: { itemId: 'shark', quantity: 20 }, 1: { itemId: 'coal', quantity: 2 } })
    const liveSnapshot = JSON.parse(JSON.stringify(live))

    reconcileIdleInventory({ base, simulated, live, itemsData: ITEMS })

    expect(live).toEqual(liveSnapshot)
  })

  it('never removes more than the live pack holds', () => {
    const base = inv({ 0: { itemId: 'shark', quantity: 10 } })
    const simulated = inv({})
    const live = inv({ 0: { itemId: 'shark', quantity: 2 } })
    const out = reconcileIdleInventory({ base, simulated, live, itemsData: ITEMS })
    expect(inventoryTotals(out.inventory).shark ?? 0).toBe(0)
  })

  // addItem fills free slots one at a time for a non-stackable and only reports
  // failure once it runs out, leaving what it already placed behind. Treating
  // that as "none of it landed" credits the bank for copies the pack is also
  // holding — item duplication, the mirror of the loss this module exists to fix.
  it('splits a gain that only partly fits, never double-counting the placed copies', () => {
    const live: Record<number, any> = {}
    for (let i = 0; i < 26; i++) live[i] = { itemId: 'kodai_hat', quantity: 1 }
    const out = reconcileIdleInventory({
      base: inv({}),
      simulated: inv({ 0: { itemId: 'shark', quantity: 1 }, 1: { itemId: 'shark', quantity: 1 }, 2: { itemId: 'shark', quantity: 1 }, 3: { itemId: 'shark', quantity: 1 }, 4: { itemId: 'shark', quantity: 1 } }),
      live: inv(live),
      itemsData: ITEMS,
    })
    const placed = inventoryTotals(out.inventory).shark ?? 0
    expect(placed).toBe(2)                       // exactly the two free slots
    expect(out.overflow.shark).toBe(3)           // the rest, and only the rest
    expect(placed + out.overflow.shark).toBe(5)  // conservation
  })

  it('overflows a stackable in full when there is no slot to start the stack', () => {
    const live: Record<number, any> = {}
    for (let i = 0; i < 28; i++) live[i] = { itemId: 'kodai_hat', quantity: 1 }
    const out = reconcileIdleInventory({
      base: inv({}),
      simulated: inv({ 0: { itemId: 'air_rune', quantity: 900 } }),
      live: inv(live),
      itemsData: ITEMS,
    })
    expect(out.overflow).toEqual({ air_rune: 900 })
    expect(inventoryTotals(out.inventory).air_rune ?? 0).toBe(0)
  })

  it('merges a stackable gain into the live stack rather than overflowing a full pack', () => {
    const live: Record<number, any> = { 0: { itemId: 'air_rune', quantity: 40 } }
    for (let i = 1; i < 28; i++) live[i] = { itemId: 'kodai_hat', quantity: 1 }
    const out = reconcileIdleInventory({
      base: inv({}),
      simulated: inv({ 0: { itemId: 'air_rune', quantity: 900 } }),
      live: inv(live),
      itemsData: ITEMS,
    })
    expect(out.overflow).toEqual({})
    expect(inventoryTotals(out.inventory).air_rune).toBe(940)
  })

  it('sends gains that no longer fit to overflow instead of dropping them', () => {
    const base = inv({})
    const simulated = inv({ 0: { itemId: 'coal', quantity: 1 }, 1: { itemId: 'coal', quantity: 1 } })
    // Live pack is completely full of something else.
    const full: Record<number, any> = {}
    for (let i = 0; i < 28; i++) full[i] = { itemId: 'kodai_hat', quantity: 1 }
    const out = reconcileIdleInventory({ base, simulated, live: inv(full), itemsData: ITEMS })
    expect(out.overflow).toEqual({ coal: 2 })
    expect(inventoryTotals(out.inventory).kodai_hat).toBe(28)
  })

  it('carries charges onto a single reconciled copy', () => {
    const base = inv({})
    const simulated = inv({ 0: { itemId: 'trident', quantity: 1, charges: 2500 } })
    const out = reconcileIdleInventory({ base, simulated, live: inv({ 5: { itemId: 'coal', quantity: 1 } }), itemsData: ITEMS })
    const landed = out.inventory.find((s: any) => s?.itemId === 'trident')
    expect(landed.charges).toBe(2500)
  })

  it('leaves an existing charge pool alone when a charged stackable merges into it', () => {
    const base = inv({})
    const simulated = inv({ 0: { itemId: 'air_rune', quantity: 1, charges: 999 } })
    const live = inv({ 0: { itemId: 'air_rune', quantity: 40 }, 1: { itemId: 'coal', quantity: 1 } })
    const out = reconcileIdleInventory({ base, simulated, live, itemsData: ITEMS })
    // Merged into the live stack — no slot was newly filled, so no charges land.
    const stack = out.inventory.find((s: any) => s?.itemId === 'air_rune')
    expect(stack.quantity).toBe(41)
    expect(stack.charges).toBeUndefined()
  })

  it('caps a live inventory longer than the slot limit instead of silently keeping it', () => {
    const long = inv({ 0: { itemId: 'shark', quantity: 2 } })
    long.push({ itemId: 'coal', quantity: 5 })
    const out = reconcileIdleInventory({
      base: inv({ 0: { itemId: 'shark', quantity: 3 } }),
      simulated: inv({ 0: { itemId: 'shark', quantity: 1 } }),
      live: long,
      itemsData: ITEMS,
    })
    expect(out.inventory).toHaveLength(28)
  })

  it('does not mint charges when several copies arrive at once', () => {
    const base = inv({})
    const simulated = inv({ 0: { itemId: 'trident', quantity: 1, charges: 2500 }, 1: { itemId: 'trident', quantity: 1 } })
    const out = reconcileIdleInventory({ base, simulated, live: inv({ 5: { itemId: 'coal', quantity: 1 } }), itemsData: ITEMS })
    const charged = out.inventory.filter((s: any) => s?.itemId === 'trident' && s.charges > 0)
    expect(charged).toHaveLength(0)
  })
})

describe('applyIdleEquipmentWear', () => {
  it('returns null when the simulation wore nothing down', () => {
    expect(applyIdleEquipmentWear({ weapon: { itemId: 'trident', charges: 100 } }, {})).toBe(null)
  })

  it('spends ammo from the live slot', () => {
    const next = applyIdleEquipmentWear(
      { ammo: { itemId: 'bronze_arrow', quantity: 500 } },
      { ammoConsumed: { itemId: 'bronze_arrow', quantity: 120 } },
    )
    expect(next!.ammo).toEqual({ itemId: 'bronze_arrow', quantity: 380 })
  })

  it('empties the ammo slot when the whole stack is spent', () => {
    const next = applyIdleEquipmentWear(
      { ammo: { itemId: 'bronze_arrow', quantity: 100 } },
      { ammoConsumed: { itemId: 'bronze_arrow', quantity: 100 } },
    )
    expect(next!.ammo).toBe(null)
  })

  it('leaves an ammo slot the player has since changed alone', () => {
    const next = applyIdleEquipmentWear(
      { ammo: { itemId: 'air_rune', quantity: 9 } },
      { ammoConsumed: { itemId: 'bronze_arrow', quantity: 100 } },
    )
    expect(next).toBe(null)
  })

  // The equipment half of the same bug: the snapshot's weapon was written back
  // wholesale, so a weapon equipped from a preset after the snapshot vanished.
  it('leaves a weapon the player swapped in after the snapshot alone', () => {
    const next = applyIdleEquipmentWear(
      { weapon: { itemId: 'kodai_hat', charges: 0 } },
      { baseEquipment: { weapon: { itemId: 'trident', charges: 2500 } }, chargesConsumed: 400 },
    )
    expect(next).toBe(null)
  })

  it('burns charges off the live weapon when it is still the same weapon', () => {
    const next = applyIdleEquipmentWear(
      { weapon: { itemId: 'trident', charges: 3000 } },
      { baseEquipment: { weapon: { itemId: 'trident', charges: 2500 } }, chargesConsumed: 400 },
    )
    expect(next!.weapon.charges).toBe(2600)
  })

  it('never drives charges below zero', () => {
    const next = applyIdleEquipmentWear(
      { weapon: { itemId: 'trident', charges: 10 } },
      { baseEquipment: { weapon: { itemId: 'trident', charges: 10 } }, chargesConsumed: 400 },
    )
    expect(next!.weapon.charges).toBe(0)
  })
})

describe('resolveIdleHoldingsWrites — the preset item-loss regression', () => {
  // End-to-end shape of the reported bug: a magic loadout is loaded (bank kit
  // moves to equipment + inventory), the tab is backgrounded before the write
  // lands, and the idle catch-up returns holding a snapshot from BEFORE the
  // swap. The old code wrote that snapshot's inventory and equipment back
  // wholesale while the bank kept the preset's removals.
  it('does not destroy a loadout the player swapped into after the snapshot', () => {
    const base = {
      inventory: inv({ 0: { itemId: 'shark', quantity: 10 } }),
      equipment: { weapon: { itemId: 'trident', charges: 2500 }, ammo: { itemId: 'bronze_arrow', quantity: 500 } },
    }
    const live = {
      inventory: inv({
        0: { itemId: 'fire_rune', quantity: 1_500_000 },
        1: { itemId: 'air_rune', quantity: 650_819 },
        2: { itemId: 'prayer_potion', quantity: 1 },
      }),
      equipment: { head: { itemId: 'kodai_hat' } },
      bank: { coal: { itemId: 'coal', quantity: 40 } },
    }
    const sim = {
      finalInventory: inv({ 0: { itemId: 'shark', quantity: 4 } }),
      ammoConsumed: { itemId: 'bronze_arrow', quantity: 500 },
      chargesConsumed: 400,
    }

    const writes = resolveIdleHoldingsWrites({
      base, sim, live, itemsData: ITEMS, bankedItems: { coal: 12 },
    })

    // Nothing the preset withdrew is destroyed.
    const totals = inventoryTotals(writes.inventory)
    expect(totals.fire_rune).toBe(1_500_000)
    expect(totals.air_rune).toBe(650_819)
    expect(totals.prayer_potion).toBe(1)
    // The reverted equipment write is gone: the live kit stands.
    expect(writes.equipment).toBe(null)
    // The bank still gets the simulation's banked loot.
    expect(writes.bankDeltas).toEqual({ coal: 12 })
    expect(writes.reconciled).toBe(true)
  })

  // Pins the defect so the test above cannot be "passed" by going back to a
  // wholesale write. Runs the same scenario through the module and asserts the
  // result differs from `sim.finalInventory` — which is precisely what the old
  // `updateInventory(sim.finalInventory)` wrote.
  it('returns something other than the raw simulated inventory once live has diverged', () => {
    const base = { inventory: inv({ 0: { itemId: 'shark', quantity: 10 } }), equipment: {} }
    const sim = { finalInventory: inv({ 0: { itemId: 'shark', quantity: 4 } }) }
    const live = { inventory: inv({ 0: { itemId: 'fire_rune', quantity: 1_500_000 } }), equipment: {}, bank: {} }

    const writes = resolveIdleHoldingsWrites({ base, sim, live, itemsData: ITEMS })

    expect(writes.inventory).not.toBe(sim.finalInventory)
    // The old write would have produced zero fire runes here — that is the bug.
    expect(inventoryTotals(sim.finalInventory).fire_rune ?? 0).toBe(0)
    expect(inventoryTotals(writes.inventory).fire_rune).toBe(1_500_000)
  })

  it('does not resurrect equipment the player changed after the snapshot', () => {
    const writes = resolveIdleHoldingsWrites({
      base: { inventory: inv({}), equipment: { head: { itemId: 'trident' } } },
      sim: { finalInventory: inv({ 0: { itemId: 'coal', quantity: 1 } }) },
      live: { inventory: inv({ 5: { itemId: 'shark', quantity: 1 } }), equipment: { head: { itemId: 'kodai_hat' } }, bank: {} },
      itemsData: ITEMS,
    })
    // No wear to apply → no equipment write at all, so the live head stands.
    expect(writes.equipment).toBe(null)
  })

  it('is an exact pass-through when the snapshot still matches live holdings', () => {
    const inventory = inv({ 0: { itemId: 'shark', quantity: 10 } })
    const equipment = { ammo: { itemId: 'bronze_arrow', quantity: 500 } }
    const sim = {
      finalInventory: inv({ 0: { itemId: 'shark', quantity: 4 }, 1: { itemId: 'coal', quantity: 9 } }),
      ammoConsumed: { itemId: 'bronze_arrow', quantity: 120 },
      chargesConsumed: 0,
    }

    const writes = resolveIdleHoldingsWrites({
      base: { inventory, equipment },
      sim,
      live: { inventory, equipment, bank: {} },
      itemsData: ITEMS,
      bankedItems: { coal: 3 },
      ammoConsumed: sim.ammoConsumed,
    })

    expect(writes.reconciled).toBe(false)
    expect(writes.inventory).toBe(sim.finalInventory)
    expect(writes.equipment!.ammo).toEqual({ itemId: 'bronze_arrow', quantity: 380 })
    expect(writes.bankDeltas).toEqual({ coal: 3 })
  })

  it('routes gains that no longer fit the live pack to the bank deltas', () => {
    const full: Record<number, any> = {}
    for (let i = 0; i < 28; i++) full[i] = { itemId: 'kodai_hat', quantity: 1 }
    const writes = resolveIdleHoldingsWrites({
      base: { inventory: inv({}), equipment: {} },
      sim: { finalInventory: inv({ 0: { itemId: 'coal', quantity: 1 }, 1: { itemId: 'coal', quantity: 1 } }) },
      live: { inventory: inv(full), equipment: {}, bank: {} },
      itemsData: ITEMS,
      bankedItems: { coal: 5 },
    })
    expect(writes.bankDeltas).toEqual({ coal: 7 })
  })

  it('conserves every item across the three containers when reconciling', () => {
    const base = { inventory: inv({ 0: { itemId: 'shark', quantity: 10 } }), equipment: {} }
    const live = {
      inventory: inv({ 0: { itemId: 'fire_rune', quantity: 900 }, 1: { itemId: 'shark', quantity: 3 } }),
      equipment: { head: { itemId: 'kodai_hat' } },
      bank: { coal: { itemId: 'coal', quantity: 40 } },
    }
    // The sim consumed 6 sharks and produced nothing new.
    const sim = { finalInventory: inv({ 0: { itemId: 'shark', quantity: 4 } }) }

    const before = heldTotals(live.equipment, live.inventory, live.bank)
    const writes = resolveIdleHoldingsWrites({ base, sim, live, itemsData: ITEMS })
    const nextBank = { ...live.bank }
    for (const [id, qty] of Object.entries(writes.bankDeltas)) {
      const current = Number(nextBank[id]?.quantity) || 0
      nextBank[id] = { itemId: id, quantity: current + qty }
    }
    const after = heldTotals(writes.equipment || live.equipment, writes.inventory, nextBank)

    // Only the simulation's own consumption changed; nothing else moved or vanished.
    expect(after.fire_rune).toBe(before.fire_rune)
    expect(after.kodai_hat).toBe(before.kodai_hat)
    expect(after.coal).toBe(before.coal)
    expect(after.shark ?? 0).toBe(0) // 3 live, 6 consumed → clamped at zero
  })
})

// Hard mode's death penalty rides the same write, because a second write would
// race the reconcile above (§4). Before this, a hard boss left running while the
// tab was shut killed the player for free — the mode's whole premise, missing on
// every idle path.
describe('resolveIdleHoldingsWrites — a hard-mode death during idle catch-up', () => {
  const HARD_ITEMS: any = { ...ITEMS, fire_cape: { id: 'fire_cape', name: 'Fire Cape', slot: 'cape', isUntradeable: true } }

  function scenario(hardModeDeath: boolean) {
    const base = {
      inventory: inv({ 0: { itemId: 'shark', quantity: 10 }, 1: { itemId: 'fire_cape', quantity: 1 } }),
      equipment: { head: { itemId: 'kodai_hat' } },
    }
    const live = {
      inventory: inv({ 0: { itemId: 'shark', quantity: 10 }, 1: { itemId: 'fire_cape', quantity: 1 } }),
      equipment: { head: { itemId: 'kodai_hat' } },
      bank: {},
    }
    const sim = { finalInventory: inv({ 0: { itemId: 'shark', quantity: 4 }, 1: { itemId: 'fire_cape', quantity: 1 } }), died: true }
    return resolveIdleHoldingsWrites({ base, sim, live, itemsData: HARD_ITEMS, bankedItems: { coal: 12 }, hardModeDeath })
  }

  it('takes the tradeable pack and the worn gear', () => {
    const writes = scenario(true)
    expect(inventoryTotals(writes.inventory).shark ?? 0).toBe(0)
    expect(writes.equipment).toEqual({})
    expect(writes.hardModeItemsLost).toEqual([{ itemId: 'shark', quantity: 4 }, { itemId: 'kodai_hat', quantity: 1 }])
  })

  it('leaves untradeables in the slot they were in', () => {
    expect(inventoryTotals(scenario(true).inventory).fire_cape).toBe(1)
  })

  it('keeps loot already banked during the window — the bank is never at risk', () => {
    expect(scenario(true).bankDeltas).toEqual({ coal: 12 })
  })

  it('changes nothing for an ordinary idle death', () => {
    const writes = scenario(false)
    expect(inventoryTotals(writes.inventory).shark).toBe(4)
    expect(writes.hardModeItemsLost).toBe(null)
  })
})
