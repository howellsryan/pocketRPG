import { describe, expect, it } from 'vitest'
import itemsData from '../src/data/items.json'
import { SLAYER_UNLOCKS, getSlayerUnlockPurchaseState, ownsItem, isSlayerStoreItem, hasSlayerStoreUnlock } from '../src/engine/slayerUnlocks.js'

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

describe('slayer store coin-purchase gating', () => {
  it('identifies every slayer unlockable as a slayer-store item', () => {
    for (const unlock of SLAYER_UNLOCKS) expect(isSlayerStoreItem(unlock.itemId)).toBe(true)
    expect(isSlayerStoreItem('slayer_helmet')).toBe(true)
    expect(isSlayerStoreItem('iron_scimitar')).toBe(false)
  })
  it('only counts a slayer item as store-unlocked when its id is in the unlock list', () => {
    expect(hasSlayerStoreUnlock(['slayer_helmet'], 'slayer_helmet')).toBe(true)
    expect(hasSlayerStoreUnlock(['slayer_helmet'], 'slayer_defender')).toBe(false)
    expect(hasSlayerStoreUnlock([], 'slayer_helmet')).toBe(false)
    expect(hasSlayerStoreUnlock(null as any, 'slayer_helmet')).toBe(false)
    // A non-slayer item never qualifies even if listed.
    expect(hasSlayerStoreUnlock(['iron_scimitar'], 'iron_scimitar')).toBe(false)
  })
})

describe("Zul-Kaar's Blade unlock", () => {
  const unlock = SLAYER_UNLOCKS.find(u => u.itemId === 'zul_kaars_blade')!
  const item = (itemsData as any)[unlock.itemId]

  it('is registered with the correct cost and a 25-completion Zul-Kaar gate', () => {
    expect(unlock.cost).toBe(2500)
    expect(unlock.requiresMasterCompletions).toEqual({ masterId: 'zul_kaar', count: 25 })
  })

  it('rejects the purchase below 25 Zul-Kaar completions even with sufficient points', () => {
    const state = getSlayerUnlockPurchaseState({
      unlock, item, slayerPoints: unlock.cost, bank: {}, inventory: [],
      masterTaskCompletions: { zul_kaar: 24 },
    })
    expect(state.allowed).toBe(false)
    expect(state.code).toBe('MASTER_COMPLETIONS_REQUIRED')
  })

  it('rejects the purchase when masterTaskCompletions is omitted entirely (defaults to 0)', () => {
    const state = getSlayerUnlockPurchaseState({ unlock, item, slayerPoints: unlock.cost, bank: {}, inventory: [] })
    expect(state.allowed).toBe(false)
    expect(state.code).toBe('MASTER_COMPLETIONS_REQUIRED')
  })

  it('allows the purchase at exactly 25 completions with sufficient points', () => {
    const state = getSlayerUnlockPurchaseState({
      unlock, item, slayerPoints: unlock.cost, bank: {}, inventory: [],
      masterTaskCompletions: { zul_kaar: 25 },
    })
    expect(state.allowed).toBe(true)
  })

  it('still enforces the points check once the completion gate is satisfied', () => {
    const state = getSlayerUnlockPurchaseState({
      unlock, item, slayerPoints: 10, bank: {}, inventory: [],
      masterTaskCompletions: { zul_kaar: 25 },
    })
    expect(state.allowed).toBe(false)
    expect(state.code).toBe('INSUFFICIENT_SLAYER_POINTS')
  })
})
