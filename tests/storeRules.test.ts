import { describe, expect, it } from 'vitest'
import items from '../src/data/items.json'
import {
  getPurchaseRestriction,
  getStoreItemTypes,
  isStoreVisibleItem,
} from '../src/engine/storeRules.js'

const itemsData = items as Record<string, any>

describe('store rules', () => {
  it('hides boss unique items from the store for normal accounts', () => {
    expect(isStoreVisibleItem(itemsData.twisted_bow, { isIronman: false })).toBe(false)
    expect(isStoreVisibleItem(itemsData.heavy_ballista, { isIronman: false })).toBe(false)
  })

  it('hides boss unique items from the store for ironman accounts', () => {
    expect(isStoreVisibleItem(itemsData.twisted_bow, { isIronman: true })).toBe(false)
    expect(isStoreVisibleItem(itemsData.heavy_ballista, { isIronman: true })).toBe(false)
  })

  it('blocks boss unique purchases before other availability rules', () => {
    const restriction = getPurchaseRestriction(itemsData.twisted_bow, { isIronman: false })
    expect(restriction.allowed).toBe(false)
    expect(restriction.code).toBe('BOSS_UNIQUE_RESTRICTED')
  })

  it('still allows normal purchasable items for normal accounts', () => {
    const restriction = getPurchaseRestriction(itemsData.bronze_scimitar, { isIronman: false })
    expect(restriction.allowed).toBe(true)
  })

  it('preserves ironman general-store restrictions', () => {
    expect(getPurchaseRestriction(itemsData.bronze_scimitar, { isIronman: true }).allowed).toBe(true)
    expect(getPurchaseRestriction(itemsData.rune_scimitar, { isIronman: true }).code).toBe('IRONMAN_RESTRICTED')
  })

  it('preserves untradeable restriction for non-quest items', () => {
    const fakeUntradeable = { id: 'fake', name: 'Fake', isUntradeable: true }
    const restriction = getPurchaseRestriction(fakeUntradeable, { isIronman: false })
    expect(restriction.allowed).toBe(false)
    expect(restriction.code).toBe('UNTRADEABLE_RESTRICTED')
  })

  it('does not include boss unique-only types in store type tabs', () => {
    const fakeItems = {
      bossOnly: { id: 'bossOnly', name: 'Boss Only', type: 'boss-only-type', isBossUnique: true, shopValue: 1 },
      normal: { id: 'normal', name: 'Normal', type: 'weapon', shopValue: 1 },
    }
    expect(getStoreItemTypes(fakeItems, { isIronman: false })).not.toContain('boss-only-type')
    expect(getStoreItemTypes(fakeItems, { isIronman: false })).toContain('weapon')
  })
})
