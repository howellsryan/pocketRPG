import { getPurchaseRestriction } from '../../../src/engine/storeRules.js'

export function assertPurchasable(item, context) {
  return getPurchaseRestriction(item, context)
}
