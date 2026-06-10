// Tradeable audit (Phase 6.1) — everything flows through the trading post
// EXCEPT the product-owner-confirmed untradeable allowlist:
//   • minigame reward items (collection log `minigames` category)
//   • skill capes (isSkillCape)
//   • Zesta / PvP bot rewards (collection log `pvp` category)
//   • quest reward items (quests.json itemUnlocks)
//   • currency + construction feature tokens (coins, money_purse,
//     master_rejuvenation — the perk lives in unlockedFeatures, so trading
//     the token would dupe it)
//
// The sets are derived from the live data files, so a future data edit that
// accidentally exposes an allowlist item (or re-locks a tradeable one) fails
// here rather than shipping.

import { describe, it, expect } from 'vitest'
import { isTradingPostListable } from '../functions/_lib/game/tradingPost.js'
import { getPurchaseRestriction, isStoreVisibleItem } from '../src/engine/storeRules.js'
import itemsData from '../src/data/items.json' assert { type: 'json' }
import collectionLog from '../src/data/collectionLog.json' assert { type: 'json' }
import questsData from '../src/data/quests.json' assert { type: 'json' }

function collectionCategoryItems(categoryId: string): Set<string> {
  const out = new Set<string>()
  const category = (collectionLog as any).categories.find((c: any) => c.id === categoryId)
  for (const section of category?.sections || []) {
    for (const itemId of section.items || []) out.add(itemId)
  }
  return out
}

function questRewardItems(): Set<string> {
  const out = new Set<string>()
  const quests = Array.isArray(questsData) ? questsData : (questsData as any).quests || []
  for (const quest of quests) {
    for (const itemId of quest.itemUnlocks || []) out.add(itemId)
  }
  return out
}

const minigameItems = collectionCategoryItems('minigames')
const pvpBotItems = collectionCategoryItems('pvp')
const questItems = questRewardItems()
const skillCapes = new Set(
  Object.values(itemsData as any).filter((i: any) => i.isSkillCape).map((i: any) => i.id),
)
const featureTokens = new Set(['coins', 'money_purse', 'master_rejuvenation'])

const allowlisted = (id: string) =>
  minigameItems.has(id) || pvpBotItems.has(id) || questItems.has(id)
  || skillCapes.has(id) || featureTokens.has(id)

describe('untradeable allowlist', () => {
  it('derives non-empty allowlist categories from the data files', () => {
    expect(minigameItems.size).toBeGreaterThan(0)
    expect(pvpBotItems.size).toBe(3) // zesta_longsword, zesta_vest, zesta_skirt
    expect(skillCapes.size).toBeGreaterThanOrEqual(17)
    expect(questItems.size).toBeGreaterThan(0)
  })

  it('every allowlisted untradeable stays off the trading post', () => {
    for (const id of [...minigameItems, ...pvpBotItems, ...skillCapes, ...featureTokens]) {
      const item = (itemsData as any)[id]
      expect(item, id).toBeDefined()
      expect(isTradingPostListable(item), `${id} must not be listable`).toBe(false)
    }
    // Quest rewards that are flagged untradeable must stay unlistable (some
    // quest unlocks, e.g. dragon weapons, are legitimately tradeable items).
    for (const id of questItems) {
      const item = (itemsData as any)[id]
      if (item?.isUntradeable) {
        expect(isTradingPostListable(item), `${id} must not be listable`).toBe(false)
      }
    }
  })

  it('every isUntradeable item in items.json belongs to an allowlist category', () => {
    const offenders = Object.values(itemsData as any)
      .filter((i: any) => i.isUntradeable && !allowlisted(i.id))
      .map((i: any) => i.id)
    expect(offenders, 'untradeable items outside the confirmed allowlist').toEqual([])
  })
})

describe('newly tradeable items list on the trading post', () => {
  // The 25 items un-locked in the 2026-06 tradeable audit.
  const FLIPPED = [
    'ashen_slayer_helm',
    'arcane_kiteshield', 'arcane_necklace', 'eagle_eyed_kiteshield',
    'chaotic_rapier', 'chaotic_longsword', 'chaotic_maul', 'chaotic_crossbow', 'chaotic_staff',
    'burnt_food',
    'climbing_boots',
    'clue_scroll_medium', 'clue_scroll_hard', 'clue_scroll_elite', 'clue_scroll_master',
    'fire_cape', 'infernal_cape',
    'gloves_of_slaughter', 'slayer_defender', 'slayer_helmet',
    'godsword_shard',
    'shardglass_bow', 'shardglass_shield', 'shardglass_shards',
    'super_combat',
  ]

  it.each(FLIPPED)('%s is trading-post listable', (id) => {
    const item = (itemsData as any)[id]
    expect(item).toBeDefined()
    expect(item.isUntradeable).toBeUndefined()
    expect(isTradingPostListable(item)).toBe(true)
  })

  it('the previously valueless capes now carry a sane shopValue', () => {
    expect((itemsData as any).fire_cape.shopValue).toBeGreaterThan(0)
    expect((itemsData as any).infernal_cape.shopValue).toBeGreaterThan((itemsData as any).fire_cape.shopValue)
  })
})

describe('special-source items trade on the order book, never the infinite store', () => {
  // Items whose only legitimate source is slayer points, dungeoneering
  // tokens, boss drops or clue scrolls. Tradeable player-to-player, but an
  // infinite coin-store supply would trivialize their acquisition path.
  const specialSource = Object.values(itemsData as any)
    .filter((i: any) => i.isSpecialSource)
    .map((i: any) => i.id)

  it('the special-source set is exactly the expected 22 items', () => {
    expect([...specialSource].sort()).toEqual([
      'arcane_kiteshield', 'arcane_necklace', 'ashen_slayer_helm',
      'chaotic_crossbow', 'chaotic_longsword', 'chaotic_maul', 'chaotic_rapier', 'chaotic_staff',
      'clue_scroll_elite', 'clue_scroll_hard', 'clue_scroll_master', 'clue_scroll_medium',
      'eagle_eyed_kiteshield', 'fire_cape', 'gloves_of_slaughter', 'godsword_shard',
      'infernal_cape', 'shardglass_bow', 'shardglass_shards', 'shardglass_shield',
      'slayer_defender', 'slayer_helmet',
    ])
  })

  it.each(Object.values(itemsData as any).filter((i: any) => i.isSpecialSource).map((i: any) => i.id))(
    '%s is listable but blocked from store purchase',
    (id) => {
      const item = (itemsData as any)[id]
      expect(item.isUntradeable).toBeUndefined()
      expect(isTradingPostListable(item)).toBe(true)
      expect(getPurchaseRestriction(item, { isIronman: false })).toMatchObject({
        allowed: false,
        code: 'SPECIAL_SOURCE_RESTRICTED',
      })
      expect(isStoreVisibleItem(item, { isIronman: false })).toBe(true)
    },
  )
})
