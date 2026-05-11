import { getPurchaseRestriction } from '../../../src/engine/storeRules.js'

export function isProtectedItem(item, threshold = 1_000_000) {
  if (!item) return true
  if (item.isBossUnique || item.isClueReward || item.isRaidUnique || item.isMinigameReward || item.isDungeoneeringReward || item.isUntradeable) return true
  return (Number(item.shopValue) || 0) >= threshold
}

export function assertPurchasable(item, context) {
  return getPurchaseRestriction(item, context)
}
