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

  it('does not flag protected deltas when moving protected items from bank to inventory', () => {
    const previousSave = { inventory: [], bank: { archers_ring: { quantity: 1 } } }
    const nextSave = { inventory: [{ itemId: 'archers_ring', quantity: 1 }], bank: { archers_ring: { quantity: 0 } } }
    const itemsData = { archers_ring: { id: 'archers_ring', isBossUnique: true } }

    expect(detectProtectedDelta(previousSave, nextSave, itemsData)).toEqual([])
  })

  it('flags net protected increases across inventory+bank totals', () => {
    const previousSave = { inventory: [], bank: { archers_ring: { quantity: 1 } } }
    const nextSave = { inventory: [{ itemId: 'archers_ring', quantity: 2 }], bank: { archers_ring: { quantity: 0 } } }
    const itemsData = { archers_ring: { id: 'archers_ring', isBossUnique: true } }

    expect(detectProtectedDelta(previousSave, nextSave, itemsData)).toEqual(['archers_ring'])
  })
})
