import { isProtectedItem } from './rewards.js'

export function detectProtectedDelta(previousSave = {}, nextSave = {}, itemsData = {}) {
  const prev = new Map((previousSave.inventory || []).map(x => [x.id, Number(x.quantity) || 0]))
  const violations = []
  for (const slot of (nextSave.inventory || [])) {
    const nextQty = Number(slot?.quantity) || 0
    const prevQty = prev.get(slot?.id) || 0
    if (nextQty > prevQty && isProtectedItem(itemsData[slot?.id])) violations.push(slot.id)
  }
  return violations
}
