export function isBossUniqueItem(item) {
  return Boolean(item?.isBossUnique)
}

export function isClueRewardItem(item) {
  return Boolean(item?.isClueReward)
}

// Items that transact through the player-to-player order book rather than the
// immediate-execute general store path. Keep this aligned with the server-side
// `isOrderBookItem` in functions/_lib/game/tradingPost.js.
//
// 2026-06: tradeable items with a shop value trade on the order book — the
// infinite general store no longer buys or sells them. The immediate-execute
// path survives for the curated General Store stock (`isGeneralStore`),
// quest-unlock items (their quest shop stays a guaranteed fixed-price
// source) and the untradeable sinks (skill capes, minigame unlock products,
// sell-immediate of untradeables). None of those appear on the order book.
export function isOrderBookItem(item) {
  if (!item) return false
  if (item.isBossUnique || item.isClueReward || item.isRaidUnique) return true
  if (item.isUntradeable || item.questUnlock || item.isGeneralStore) return false
  return Math.floor(Number(item.shopValue) || 0) > 0
}

export function getPurchaseRestriction(item, { isIronman = false, allowMinigameUnlockPurchase = false } = {}) {
  if (!item) {
    return { allowed: false, code: 'ITEM_NOT_FOUND', message: 'Item not found' }
  }

  if (isBossUniqueItem(item)) {
    return {
      allowed: false,
      code: 'BOSS_UNIQUE_RESTRICTED',
      message: 'Boss unique drops can only be obtained from boss and raid drops.',
    }
  }

  if (isClueRewardItem(item)) {
    return {
      allowed: false,
      code: 'CLUE_REWARD_RESTRICTED',
      message: 'This item can only be obtained from clue scroll rewards.',
    }
  }

  // Everything else on the order book is player-to-player only — the
  // infinite store sells the curated General Store stock, quest-unlock
  // items, skill capes and minigame unlock products, nothing more.
  if (isOrderBookItem(item)) {
    return {
      allowed: false,
      code: 'ORDER_BOOK_REQUIRED',
      message: 'This item is traded between players on the Trading Post order book.',
    }
  }

  const isQuestItem = Boolean(item.questUnlock)
  const isMinigameUnlockItem = allowMinigameUnlockPurchase === true
  const isSkillCape = Boolean(item.isSkillCape)

  if (item.isUntradeable && !isQuestItem && !isMinigameUnlockItem && !isSkillCape) {
    return {
      allowed: false,
      code: 'UNTRADEABLE_RESTRICTED',
      message: 'This item cannot be purchased',
    }
  }

  if (isIronman && !isQuestItem && !item.isGeneralStore) {
    return {
      allowed: false,
      code: 'IRONMAN_RESTRICTED',
      message: 'This item is not available to Ironman characters',
    }
  }

  return { allowed: true, code: null, message: null }
}

export function isStoreVisibleItem(item, { isIronman = false, includeQuestItems = true } = {}) {
  if (!item) return false
  if (isBossUniqueItem(item) || isClueRewardItem(item)) return true

  const isQuestItem = Boolean(item.questUnlock)
  if (isQuestItem) return includeQuestItems
  if (item.isSkillCape) return !isIronman
  if (item.isUntradeable) return false
  if (isIronman) return Boolean(item.isGeneralStore)
  return true
}

export function getStoreItemTypes(itemsData, { isIronman = false } = {}) {
  const types = new Set()
  for (const item of Object.values(itemsData || {})) {
    if (isStoreVisibleItem(item, { isIronman, includeQuestItems: false }) && item.type) {
      types.add(item.type)
    }
  }
  return Array.from(types).sort()
}
