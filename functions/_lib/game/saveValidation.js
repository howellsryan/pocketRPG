import { isProtectedItem } from './rewards.js'

export function detectProtectedDelta(previousSave = {}, nextSave = {}, itemsData = {}) {
  const prev = new Map()
  for (const slot of (previousSave.inventory || [])) {
    const itemId = slot?.id ?? slot?.itemId ?? null
    if (!itemId) continue
    const qty = Number(slot?.quantity) || 0
    prev.set(itemId, (prev.get(itemId) || 0) + qty)
  }
  const next = new Map()
  for (const slot of (nextSave.inventory || [])) {
    const itemId = slot?.id ?? slot?.itemId ?? null
    if (!itemId) continue
    const qty = Number(slot?.quantity) || 0
    next.set(itemId, (next.get(itemId) || 0) + qty)
  }
  const violations = []
  for (const [itemId, nextQty] of next.entries()) {
    const prevQty = prev.get(itemId) || 0
    if (nextQty > prevQty && isProtectedItem(itemsData[itemId])) violations.push(itemId)
  }
  return violations
}
