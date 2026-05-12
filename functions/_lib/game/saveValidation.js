import { isProtectedItem } from './rewards.js'

export function detectProtectedDelta(previousSave = {}, nextSave = {}, itemsData = {}) {
  const prev = new Map((previousSave.inventory || []).map((slot) => {
    const itemId = slot?.id ?? slot?.itemId ?? null
    return [itemId, Number(slot?.quantity) || 0]
  }))
  const violations = []
  for (const slot of (nextSave.inventory || [])) {
    const itemId = slot?.id ?? slot?.itemId ?? null
    if (!itemId) continue
    const nextQty = Number(slot?.quantity) || 0
    const prevQty = prev.get(itemId) || 0
    if (nextQty > prevQty && isProtectedItem(itemsData[itemId])) violations.push(itemId)
  }
  return violations
}
