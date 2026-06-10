import { describe, expect, it } from 'vitest'
import items from '../src/data/items.json'
import clues from '../src/data/clues.json'
import { getPurchaseRestriction, getStoreItemTypes, isStoreVisibleItem } from '../src/engine/storeRules.js'
const itemsData = items as Record<string, any>
const cluesData = clues as Record<string, { rewards: Array<{ itemId: string }> }>

const clueRewardIds = [...new Set(Object.values(cluesData).flatMap(level => level.rewards.map(reward => reward.itemId)))]
const clueRewardUniques = clueRewardIds.filter(itemId => itemsData[itemId]?.isClueReward)

describe('store rules', () => {
  it('shows boss uniques for discovery', () => {
    expect(isStoreVisibleItem(itemsData.twisted_longbow, { isIronman: false })).toBe(true)
    expect(isStoreVisibleItem(itemsData.twisted_longbow, { isIronman: true })).toBe(true)
  })
  it('blocks boss unique purchases', () => {
    const r = getPurchaseRestriction(itemsData.twisted_longbow, { isIronman: false })
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('BOSS_UNIQUE_RESTRICTED')
  })
  it('shows clue rewards for discovery and blocks purchases', () => {
    const rangerBoots = itemsData.pathfinder_boots
    expect(isStoreVisibleItem(rangerBoots, { isIronman: false })).toBe(true)
    expect(isStoreVisibleItem(rangerBoots, { isIronman: true })).toBe(true)
    expect(getPurchaseRestriction(rangerBoots, { isIronman: false })).toMatchObject({
      allowed: false,
      code: 'CLUE_REWARD_RESTRICTED',
    })
  })
  it('hides slayer point gear in normal store', () => {
    expect(isStoreVisibleItem(itemsData.slayer_defender, { isIronman: false })).toBe(false)
    expect(isStoreVisibleItem(itemsData.gloves_of_slaughter, { isIronman: false })).toBe(false)
  })
  it('routes ordinary tradeable items to the order book (no infinite store)', () => {
    expect(getPurchaseRestriction(itemsData.bronze_scimitar, { isIronman: false })).toMatchObject({
      allowed: false,
      code: 'ORDER_BOOK_REQUIRED',
    })
    expect(getPurchaseRestriction(itemsData.runeforged_crossbow, { isIronman: true }).code).toBe('ORDER_BOOK_REQUIRED')
    // Items stay browsable — acquisition is the player order book.
    expect(isStoreVisibleItem(itemsData.bronze_scimitar, { isIronman: false })).toBe(true)
    expect(isStoreVisibleItem(itemsData.runeforged_crossbow, { isIronman: true })).toBe(true)
  })
  it('keeps the quest shop and skill cape purchase paths', () => {
    expect(itemsData.dragon_dagger.questUnlock).toBeTruthy()
    expect(getPurchaseRestriction(itemsData.dragon_dagger, { isIronman: false }).allowed).toBe(true)
    expect(getPurchaseRestriction(itemsData.attack_cape, { isIronman: false }).allowed).toBe(true)
  })
  it('type tabs can include restricted-only types', () => {
    const fake = {
      a: { type: 'boss-only-type', isBossUnique: true },
      b: { type: 'clue-only-type', isClueReward: true },
      c: { type: 'weapon', shopValue: 1 }
    }
    const types = getStoreItemTypes(fake as any, { isIronman: false })
    expect(types).toContain('boss-only-type')
    expect(types).toContain('clue-only-type')
  })
  it('allows clue-reward items to remain sellable via isUntradeable false', () => {
    expect(itemsData.pathfinder_boots.isClueReward).toBe(true)
    expect(itemsData.pathfinder_boots.isUntradeable).toBe(false)
  })
  it('marks only clue-specific rewards with isClueReward', () => {
    expect(clueRewardUniques.length).toBeGreaterThan(0)
    expect(itemsData.bronze_scimitar.isClueReward).toBeUndefined()
  })
})
