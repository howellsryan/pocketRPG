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

export function getPurchaseRestriction(item, { isIronman = false, isOneLife = false, allowMinigameUnlockPurchase = false, allowSlayerStorePurchase = false } = {}) {
  if (!item) {
    return { allowed: false, code: 'ITEM_NOT_FOUND', message: 'Item not found' }
  }

  // Account-identity items (the Ironman / One Life Ironman full helms) sell from
  // the store, but only to the exact matching account type — a standard Ironman
  // gets the Ironman helm, a One Life Ironman the One Life Ironman helm, and
  // neither can buy the other's. Everyone else is blocked outright.
  if (item.requiresAccount === 'ironman' && !(isIronman && !isOneLife)) {
    return {
      allowed: false,
      code: 'ACCOUNT_TYPE_RESTRICTED',
      message: 'Only standard Ironman characters can buy this item.',
    }
  }
  if (item.requiresAccount === 'ironman_onelife' && !(isIronman && isOneLife)) {
    return {
      allowed: false,
      code: 'ACCOUNT_TYPE_RESTRICTED',
      message: 'Only One Life Ironman characters can buy this item.',
    }
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
  // Slayer unlockables sell for coins once the account has unlocked them with
  // slayer points. The caller derives this flag from the save's
  // `slayerStoreUnlocks` list (server-side: the loaded save; client-side: game
  // state), so the untradeable/Ironman gates below don't block the coin sale.
  const isSlayerStoreItem = allowSlayerStorePurchase === true
  const isSkillCape = Boolean(item.isSkillCape)
  // The Max Cape is an untradeable prestige reward bought from the store once the
  // account is maxed (the total-level gate is enforced server-side in
  // functions/api/purchase.js). Treat it like a skill cape for store rules.
  const isMaxCape = Boolean(item.isMaxCape)

  if (item.isUntradeable && !isQuestItem && !isMinigameUnlockItem && !isSkillCape && !isMaxCape && !isSlayerStoreItem) {
    return {
      allowed: false,
      code: 'UNTRADEABLE_RESTRICTED',
      message: 'This item cannot be purchased',
    }
  }

  // Skill capes, the max cape and unlocked slayer gear are self-obtained rewards
  // that Ironman accounts may buy; everything else still follows the General
  // Store restriction for Ironmen.
  if (isIronman && !isQuestItem && !item.isGeneralStore && !isSkillCape && !isMaxCape && !isSlayerStoreItem) {
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
  // Skill capes and the max cape are browsable (and buyable) for everyone,
  // Ironman included.
  if (item.isSkillCape || item.isMaxCape) return true
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
