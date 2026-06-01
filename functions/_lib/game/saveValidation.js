import { isProtectedItem } from './rewards.js'
import { getTotalLevelFromSave } from '../saveSummary.js'
import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
import cluesData from '../../../src/data/clues.json' assert { type: 'json' }

const MONSTER_DROP_ITEMS = new Set(
  Object.values(monstersData || {}).flatMap(monster => (monster?.drops || []).map(drop => drop?.itemId)).filter(Boolean)
)
const CLUE_REWARD_ITEMS = new Set(
  Object.values(cluesData || {}).flatMap(clue => (clue?.rewards || []).map(reward => reward?.itemId)).filter(Boolean)
)

function isProtectedDeltaExempt(itemId) {
  if (!itemId) return true
  return MONSTER_DROP_ITEMS.has(itemId) || CLUE_REWARD_ITEMS.has(itemId)
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

// Total-level regression guard. PocketRPG XP is monotonic — XP only ever
// increases (capped at 200M) and every skill level is derived from it (1–99),
// so there is NO legitimate gameplay path that lowers a character's total
// level. A save whose total level falls below the stored save is the
// signature of a fresh / "level 3" character being written over a real one
// (e.g. a boot that mistook a failed cloud read for "no save yet" and flushed
// a new game). Callers reject the write so that class of bug can never wipe a
// live character. A null/empty next save counts as total level 0.
export function detectTotalLevelRegression(previousSave = {}, nextSave = {}) {
  const previousTotalLevel = getTotalLevelFromSave(previousSave)
  const nextTotalLevel = getTotalLevelFromSave(nextSave)
  return {
    regressed: nextTotalLevel < previousTotalLevel,
    previousTotalLevel,
    nextTotalLevel,
  }
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
