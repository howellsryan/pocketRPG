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
})
