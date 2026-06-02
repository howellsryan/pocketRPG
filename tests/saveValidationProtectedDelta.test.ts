import { describe, it, expect } from 'vitest'
import { detectProtectedDelta } from '../functions/_lib/game/saveValidation.js'

describe('detectProtectedDelta', () => {
  it('accepts itemId-based inventory slots without false protected violations', () => {
    const previousSave = { inventory: [{ itemId: 'coins', quantity: 100 }] }
    const nextSave = { inventory: [{ itemId: 'coins', quantity: 150 }] }
    const itemsData = { coins: { id: 'coins', shopValue: 1 } }

    expect(detectProtectedDelta(previousSave, nextSave, itemsData)).toEqual([])
  })

  it('reports protected increases using itemId fallback key', () => {
    const previousSave = { inventory: [{ itemId: 'dragon_claw', quantity: 0 }] }
    const nextSave = { inventory: [{ itemId: 'dragon_claw', quantity: 1 }] }
    const itemsData = { dragon_claw: { id: 'dragon_claw', isBossUnique: true } }

    expect(detectProtectedDelta(previousSave, nextSave, itemsData)).toEqual(['dragon_claw'])
  })

  it('does not flag protected deltas when stack totals are unchanged across slot rearranges', () => {
    const previousSave = { inventory: [{ itemId: 'archers_ring', quantity: 1 }, { itemId: 'archers_ring', quantity: 1 }] }
    const nextSave = { inventory: [{ itemId: 'archers_ring', quantity: 2 }] }
    const itemsData = { archers_ring: { id: 'archers_ring', isBossUnique: true } }

    expect(detectProtectedDelta(previousSave, nextSave, itemsData)).toEqual([])
  })

  it('does not flag protected deltas when withdrawing from bank to inventory', () => {
    const previousSave = { inventory: [], bank: { archers_ring: { quantity: 1 } } }
    const nextSave = { inventory: [{ itemId: 'archers_ring', quantity: 1 }], bank: {} }
    const itemsData = { archers_ring: { id: 'archers_ring', isBossUnique: true } }

    expect(detectProtectedDelta(previousSave, nextSave, itemsData)).toEqual([])
  })

  it('does not flag protected deltas when equipping from inventory', () => {
    const previousSave = { inventory: [{ itemId: 'archers_ring', quantity: 1 }], equipment: {} }
    const nextSave = { inventory: [], equipment: { ring: { itemId: 'archers_ring' } } }
    const itemsData = { archers_ring: { id: 'archers_ring', isBossUnique: true } }

    expect(detectProtectedDelta(previousSave, nextSave, itemsData)).toEqual([])
  })

  it('does not flag protected monster-drop items like clue scrolls and coins', () => {
    const previousSave = { inventory: [] }
    const nextSave = { inventory: [{ itemId: 'coins', quantity: 1000 }, { itemId: 'clue_scroll_master', quantity: 1 }] }
    const itemsData = {
      coins: { id: 'coins', shopValue: 1_000_000_000 },
      clue_scroll_master: { id: 'clue_scroll_master', isClueReward: true },
    }

    expect(detectProtectedDelta(previousSave, nextSave, itemsData)).toEqual([])
  })

  it('does not flag clue reward uniques that appear in the canonical clue tables', () => {
    const previousSave = { inventory: [], bank: {} }
    const nextSave = { inventory: [], bank: { pathfinder_boots: { quantity: 1 } } }
    const itemsData = {
      pathfinder_boots: { id: 'pathfinder_boots', isClueReward: true, shopValue: 1_700_000 },
    }

    expect(detectProtectedDelta(previousSave, nextSave, itemsData)).toEqual([])
  })

  it('does not flag master-tier 2nd age clue uniques granted to the bank', () => {
    const previousSave = { inventory: [], bank: {} }
    const nextSave = { inventory: [], bank: { '2nd_age_druidic_staff': { quantity: 1 } } }
    const itemsData = {
      '2nd_age_druidic_staff': { id: '2nd_age_druidic_staff', isClueReward: true, shopValue: 50_000_000 },
    }

    expect(detectProtectedDelta(previousSave, nextSave, itemsData)).toEqual([])
  })

  it('does not flag raid uniques granted server-authoritatively (Crimson Night Theatre)', () => {
    // Scythe of Vythar is a Crimson Night Theatre unique with a 300M shopValue,
    // so isProtectedItem flags it — but it is granted by the raid-complete
    // endpoint and rides along in routine saves, so it must be exempt.
    const previousSave = { inventory: [], bank: {} }
    const nextSave = { inventory: [{ itemId: 'scythe_of_vythar', quantity: 1 }], bank: {} }
    const itemsData = { scythe_of_vythar: { id: 'scythe_of_vythar', shopValue: 300_000_000 } }

    expect(detectProtectedDelta(previousSave, nextSave, itemsData)).toEqual([])
  })

  it('exempts every Crimson Night Theatre unique from the protected-delta guard', () => {
    const raidUniques = [
      'avernal_defender', 'ghraxis_rapier', 'sanguine_staff',
      'justicar_faceguard', 'justicar_chestguard', 'justicar_legguards', 'scythe_of_vythar',
    ]
    const itemsData = Object.fromEntries(raidUniques.map(id => [id, { id, shopValue: 100_000_000 }]))
    for (const itemId of raidUniques) {
      const previousSave = { inventory: [], bank: {} }
      const nextSave = { inventory: [{ itemId, quantity: 1 }], bank: {} }
      expect(detectProtectedDelta(previousSave, nextSave, itemsData)).toEqual([])
    }
  })

  it('still flags a protected item with no server-authoritative reward source', () => {
    // Sanity check that the exemption did not become a blanket pass — a high
    // value item that is not in any reward table is still rejected.
    const previousSave = { inventory: [] }
    const nextSave = { inventory: [{ itemId: 'totally_made_up_item', quantity: 1 }] }
    const itemsData = { totally_made_up_item: { id: 'totally_made_up_item', shopValue: 50_000_000 } }

    expect(detectProtectedDelta(previousSave, nextSave, itemsData)).toEqual(['totally_made_up_item'])
  })
})
