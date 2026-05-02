import { describe, expect, it } from 'vitest'
import items from '../src/data/items.json'
import { getPurchaseRestriction, getStoreItemTypes, isStoreVisibleItem } from '../src/engine/storeRules.js'
const itemsData = items as Record<string, any>

describe('store rules', () => {
  it('shows boss uniques for discovery', () => {
    expect(isStoreVisibleItem(itemsData.twisted_bow, { isIronman: false })).toBe(true)
    expect(isStoreVisibleItem(itemsData.twisted_bow, { isIronman: true })).toBe(true)
  })
  it('blocks boss unique purchases', () => {
    const r = getPurchaseRestriction(itemsData.twisted_bow, { isIronman: false })
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('BOSS_UNIQUE_RESTRICTED')
  })
  it('hides slayer point gear in normal store', () => {
    expect(isStoreVisibleItem(itemsData.slayer_defender, { isIronman: false })).toBe(false)
    expect(isStoreVisibleItem(itemsData.gloves_of_slaughter, { isIronman: false })).toBe(false)
  })
  it('preserves normal and ironman restrictions', () => {
    expect(getPurchaseRestriction(itemsData.bronze_scimitar, { isIronman: false }).allowed).toBe(true)
    expect(getPurchaseRestriction(itemsData.rune_scimitar, { isIronman: true }).code).toBe('IRONMAN_RESTRICTED')
  })
  it('type tabs can include boss-unique-only type', () => {
    const fake = { a: { type: 'boss-only-type', isBossUnique: true }, b: { type: 'weapon', shopValue: 1 } }
    expect(getStoreItemTypes(fake as any, { isIronman: false })).toContain('boss-only-type')
  })
})
