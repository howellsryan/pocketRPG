import { describe, expect, it } from 'vitest'
import itemsData from '../src/data/items.json'
import { SLAYER_UNLOCKS, getSlayerUnlockPurchaseState, ownsItem } from '../src/engine/slayerUnlocks.js'

describe('slayer unlocks', () => {
  it('contains expected unlocks and costs', () => {
    expect(SLAYER_UNLOCKS.find(u => u.itemId === 'slayer_helmet')?.cost).toBe(400)
    expect(SLAYER_UNLOCKS.find(u => u.itemId === 'slayer_defender')?.cost).toBe(1500)
    expect(SLAYER_UNLOCKS.find(u => u.itemId === 'gloves_of_slaughter')?.cost).toBe(1500)
  })
  it('blocks duplicates and insufficient points', () => {
    const unlock = SLAYER_UNLOCKS.find(u => u.itemId === 'slayer_defender')!
    expect(getSlayerUnlockPurchaseState({ unlock, item: (itemsData as any)[unlock.itemId], slayerPoints: 2000, bank: { slayer_defender: { quantity: 1 } }, inventory: [] }).code).toBe('ALREADY_OWNED')
    expect(getSlayerUnlockPurchaseState({ unlock, item: (itemsData as any)[unlock.itemId], slayerPoints: 10, bank: {}, inventory: [] }).code).toBe('INSUFFICIENT_SLAYER_POINTS')
  })
  it('allows purchase with sufficient points when not owned (object-form ownsItem)', () => {
    const unlock = SLAYER_UNLOCKS.find(u => u.itemId === 'slayer_defender')!
    // SlayerScreen calls ownsItem({ itemId, bank, inventory }); guard the signature.
    expect(ownsItem({ itemId: unlock.itemId, bank: {}, inventory: [] })).toBe(false)
    expect(ownsItem({ itemId: unlock.itemId, bank: { slayer_defender: { quantity: 1 } }, inventory: [] })).toBe(true)
    const state = getSlayerUnlockPurchaseState({ unlock, item: (itemsData as any)[unlock.itemId], slayerPoints: unlock.cost, bank: {}, inventory: [] })
    expect(state.allowed).toBe(true)
  })
})
