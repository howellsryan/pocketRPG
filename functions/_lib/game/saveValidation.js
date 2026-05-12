import { isProtectedItem } from './rewards.js'

function accumulateInventoryTotals(save = {}) {
  const totals = new Map()
  for (const slot of (save.inventory || [])) {
    const itemId = slot?.id ?? slot?.itemId ?? null
    if (!itemId) continue
    const qty = Number(slot?.quantity) || 0
    totals.set(itemId, (totals.get(itemId) || 0) + qty)
  }
  return totals
}

function accumulateBankTotals(save = {}, totals = new Map()) {
  const bank = save?.bank && typeof save.bank === 'object' ? save.bank : {}
  for (const [itemId, raw] of Object.entries(bank)) {
    if (!itemId) continue
    let qty = 0
    if (typeof raw === 'number') qty = raw
    else qty = Number(raw?.quantity) || 0
    totals.set(itemId, (totals.get(itemId) || 0) + qty)
  }
  return totals
}

export function detectProtectedDelta(previousSave = {}, nextSave = {}, itemsData = {}) {
  const prev = accumulateBankTotals(previousSave, accumulateInventoryTotals(previousSave))
  const next = accumulateBankTotals(nextSave, accumulateInventoryTotals(nextSave))
  const violations = []
  for (const [itemId, nextQty] of next.entries()) {
    const prevQty = prev.get(itemId) || 0
    if (nextQty > prevQty && isProtectedItem(itemsData[itemId])) violations.push(itemId)
  }
  return violations
}
