import { describe, expect, it } from 'vitest'
import items from '../src/data/items.json'
import clues from '../src/data/clues.json'
import { getPurchaseRestriction, isStoreVisibleItem } from '../src/engine/storeRules.js'

const itemsData = items as Record<string, any>
const cluesData = clues as Record<string, { rewards: Array<{ itemId: string }> }>

describe('clue reward data integrity', () => {
  it('does not use accidental tradeable item metadata', () => {
    for (const [itemId, item] of Object.entries(itemsData)) {
      expect(item, `${itemId} must not define tradeable`).not.toHaveProperty('tradeable')
    }
  })

  it('clue reward uniques are sellable via isUntradeable false but not purchasable', () => {
    const clueRewardItems = Object.entries(itemsData).filter(([, item]) => item.isClueReward)

    expect(clueRewardItems.length).toBeGreaterThan(0)

    for (const [itemId, item] of clueRewardItems) {
      expect(item.isUntradeable, `${itemId} must be sellable/tradeable via isUntradeable false`).toBe(false)
      expect(Number.isFinite(Number(item.shopValue)), `${itemId} should have numeric shopValue`).toBe(true)
      expect(Number(item.shopValue), `${itemId} should have non-negative shopValue`).toBeGreaterThanOrEqual(0)

      expect(isStoreVisibleItem(item, { isIronman: false }), `${itemId} should be visible`).toBe(true)

      expect(getPurchaseRestriction(item, { isIronman: false })).toMatchObject({
        allowed: false,
        code: 'CLUE_REWARD_RESTRICTED',
      })
    }
  })

  it('does not require ordinary clue-table filler items to be clue uniques', () => {
    const clueRewardIds = new Set(
      Object.values(cluesData).flatMap((level) => level.rewards.map((reward) => reward.itemId)),
    )

    expect(clueRewardIds.size).toBeGreaterThan(0)
    expect(clueRewardIds.has('air_rune')).toBe(true)
    expect(itemsData.air_rune.isClueReward).toBeUndefined()
  })
})
