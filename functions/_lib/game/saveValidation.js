import { isProtectedItem } from './rewards.js'
import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }

const MONSTER_DROP_ITEMS = new Set(
  Object.values(monstersData || {}).flatMap(monster => (monster?.drops || []).map(drop => drop?.itemId)).filter(Boolean)
)

function isProtectedDeltaExempt(itemId) {
  if (!itemId) return true
  return MONSTER_DROP_ITEMS.has(itemId)
}

function addQuantity(map, itemId, quantity) {
  if (!itemId) return
  const qty = Number(quantity) || 0
  if (qty <= 0) return
  map.set(itemId, (map.get(itemId) || 0) + qty)
}

function getOwnedTotals(save = {}) {
  const totals = new Map()
  for (const slot of (save.inventory || [])) {
    const itemId = slot?.id ?? slot?.itemId ?? null
    addQuantity(totals, itemId, slot?.quantity)
  }
  const bank = save.bank && typeof save.bank === 'object' ? save.bank : {}
  for (const [itemId, entry] of Object.entries(bank)) {
    const qty = typeof entry === 'number' ? entry : entry?.quantity
    addQuantity(totals, itemId, qty)
  }
  const equipment = save.equipment && typeof save.equipment === 'object' ? save.equipment : {}
  for (const equipped of Object.values(equipment)) {
    const itemId = equipped?.id ?? equipped?.itemId ?? null
    if (!itemId) continue
    const qty = Number(equipped?.quantity)
    addQuantity(totals, itemId, Number.isFinite(qty) && qty > 0 ? qty : 1)
  }
  return totals
}

export function detectProtectedDelta(previousSave = {}, nextSave = {}, itemsData = {}) {
  const prev = getOwnedTotals(previousSave)
  const next = getOwnedTotals(nextSave)
  const violations = []
  for (const [itemId, nextQty] of next.entries()) {
    const prevQty = prev.get(itemId) || 0
    if (nextQty > prevQty && isProtectedItem(itemsData[itemId]) && !isProtectedDeltaExempt(itemId)) violations.push(itemId)
  }
  return violations
}
