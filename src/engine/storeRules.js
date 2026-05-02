export function isBossUniqueItem(item) {
  return Boolean(item?.isBossUnique)
}

export function isClueRewardItem(item) {
  return Boolean(item?.isClueReward)
}

export function getPurchaseRestriction(item, { isIronman = false } = {}) {
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

  const isQuestItem = Boolean(item.questUnlock)

  if (item.isUntradeable && !isQuestItem) {
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
