import { describe, expect, it } from 'vitest'
import items from '../src/data/items.json'
import clues from '../src/data/clues.json'
import { getPurchaseRestriction, getStoreItemTypes, isStoreVisibleItem, isOrderBookItem } from '../src/engine/storeRules.js'
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
    expect(getPurchaseRestriction(itemsData.iron_scimitar, { isIronman: false })).toMatchObject({
      allowed: false,
      code: 'ORDER_BOOK_REQUIRED',
    })
    expect(getPurchaseRestriction(itemsData.runeforged_crossbow, { isIronman: true }).code).toBe('ORDER_BOOK_REQUIRED')
    // Items stay browsable — acquisition is the player order book. (Ironman
    // visibility follows the re-curated isGeneralStore flag, so it's false.)
    expect(isStoreVisibleItem(itemsData.iron_scimitar, { isIronman: false })).toBe(true)
    expect(isStoreVisibleItem(itemsData.runeforged_crossbow, { isIronman: false })).toBe(true)
    expect(isStoreVisibleItem(itemsData.runeforged_crossbow, { isIronman: true })).toBe(false)
  })
  it('keeps the quest shop and skill cape purchase paths', () => {
    expect(itemsData.dragon_dagger.questUnlock).toBeTruthy()
    expect(getPurchaseRestriction(itemsData.dragon_dagger, { isIronman: false }).allowed).toBe(true)
    expect(getPurchaseRestriction(itemsData.attack_cape, { isIronman: false }).allowed).toBe(true)
  })
  it('lets Ironman accounts buy skill capes (self-obtained prestige rewards)', () => {
    expect(getPurchaseRestriction(itemsData.attack_cape, { isIronman: true }).allowed).toBe(true)
    expect(isStoreVisibleItem(itemsData.attack_cape, { isIronman: true })).toBe(true)
  })
  it('treats the max cape like a skill cape: untradeable but purchasable + visible to all', () => {
    expect(itemsData.max_cape.isMaxCape).toBe(true)
    expect(itemsData.max_cape.isUntradeable).toBe(true)
    expect(getPurchaseRestriction(itemsData.max_cape, { isIronman: false }).allowed).toBe(true)
    expect(getPurchaseRestriction(itemsData.max_cape, { isIronman: true }).allowed).toBe(true)
    expect(isStoreVisibleItem(itemsData.max_cape, { isIronman: false })).toBe(true)
    expect(isStoreVisibleItem(itemsData.max_cape, { isIronman: true })).toBe(true)
  })
  it('keeps the infernal max cape out of the store (combine-only)', () => {
    expect(itemsData.infernal_max_cape.isMaxCape).toBeUndefined()
    expect(itemsData.infernal_max_cape.isUntradeable).toBe(true)
    expect(getPurchaseRestriction(itemsData.infernal_max_cape, { isIronman: false })).toMatchObject({
      allowed: false,
      code: 'UNTRADEABLE_RESTRICTED',
    })
    expect(isStoreVisibleItem(itemsData.infernal_max_cape, { isIronman: false })).toBe(false)
  })
  it('sells General Store stock through the fixed-price store, not the order book', () => {
    for (const id of ['air_rune', 'bronze_scimitar', 'anti_dragon_shield', 'staff_of_fire', 'feather', 'fishing_rod']) {
      expect(itemsData[id].isGeneralStore, `${id} should be General Store stock`).toBe(true)
      expect(isOrderBookItem(itemsData[id]), `${id} should not be order-book`).toBe(false)
      expect(getPurchaseRestriction(itemsData[id], { isIronman: false }).allowed, `${id} should be purchasable`).toBe(true)
    }
  })
  it('keeps the curated General Store list aligned with the category spec', () => {
    // The flag set in items.json: all runes, all bronze items, the four
    // elemental staves, shortbow/crossbow, the wizard garments, plus a
    // handful of named staples. Anything else must be false.
    const expected = new Set([
      ...Object.keys(itemsData).filter((id) => itemsData[id].type === 'rune' || /(^|_)rune$/.test(id)),
      ...Object.keys(itemsData).filter((id) => id.startsWith('bronze_')),
      'staff_of_air', 'staff_of_water', 'staff_of_fire', 'staff_of_earth',
      'shortbow', 'crossbow',
      'wizard_hat', 'black_wizard_hat', 'wizard_robe_top', 'wizard_robe_skirt',
      'anti_dragon_shield', 'feather', 'greenthorn_seed',
      'fishing_net', 'harpoon', 'lobster_cage', 'fishing_rod',
      'empty_bird_s_nest',
      // Account-identity helms — store-sold, gated to the matching account type.
      'ironman_helm', 'onelife_ironman_helm',
    ])
    const flagged = new Set(Object.keys(itemsData).filter((id) => itemsData[id].isGeneralStore === true))
    expect([...flagged].sort()).toEqual([...expected].sort())
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
  it('gates the account-identity helms to the matching account type', () => {
    const iron = itemsData.ironman_helm
    const dragon = itemsData.onelife_ironman_helm
    expect(iron.requiresAccount).toBe('ironman')
    expect(dragon.requiresAccount).toBe('ironman_onelife')

    // Ironman helm: any Ironman may buy it; non-Ironman are blocked.
    expect(getPurchaseRestriction(iron, { isIronman: false }).code).toBe('ACCOUNT_TYPE_RESTRICTED')
    expect(getPurchaseRestriction(iron, { isIronman: true }).allowed).toBe(true)
    expect(getPurchaseRestriction(iron, { isIronman: true, isOneLife: true }).allowed).toBe(true)

    // One Life Ironman helm: only Ironman + One Life accounts may buy it.
    expect(getPurchaseRestriction(dragon, { isIronman: false }).code).toBe('ACCOUNT_TYPE_RESTRICTED')
    expect(getPurchaseRestriction(dragon, { isIronman: true }).code).toBe('ACCOUNT_TYPE_RESTRICTED')
    expect(getPurchaseRestriction(dragon, { isIronman: true, isOneLife: true }).allowed).toBe(true)
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
