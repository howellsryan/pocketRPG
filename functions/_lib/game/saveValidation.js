import { isProtectedItem } from './rewards.js'
import { getTotalLevelFromSave } from '../saveSummary.js'
import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
import cluesData from '../../../src/data/clues.json' assert { type: 'json' }
import raidsData from '../../../src/data/raids.json' assert { type: 'json' }
import minigamesData from '../../../src/data/minigames.json' assert { type: 'json' }
import skillsData from '../../../src/data/skills.json' assert { type: 'json' }

const MONSTER_DROP_ITEMS = new Set(
  Object.values(monstersData || {}).flatMap(monster => (monster?.drops || []).map(drop => drop?.itemId)).filter(Boolean)
)
const CLUE_REWARD_ITEMS = new Set(
  Object.values(cluesData || {}).flatMap(clue => (clue?.rewards || []).map(reward => reward?.itemId)).filter(Boolean)
)
// Raid rewards (both the guaranteed "always" table and the unique drop pool) are
// granted server-authoritatively by /api/actions/raid/complete, which mutates
// the save and persists the item before returning. The granted item then rides
// along in every subsequent routine /api/save PUT, so it MUST be exempt from the
// protected-delta guard — otherwise the first autosave after a raid unique drop
// (e.g. Crimson Night Theatre's Scythe of Vythar) is rejected as a forged
// delta and the save wedges. Mirrors the monster-drop / clue-reward exemptions.
const RAID_REWARD_ITEMS = new Set(
  Object.values(raidsData || {}).flatMap(raid => [
    ...((raid?.rewards?.always || []).map(reward => reward?.itemId)),
    ...((raid?.rewards?.unique?.items || []).map(reward => reward?.itemId)),
  ]).filter(Boolean)
)
// Minigame rewards (task product + bonus rewardItems) and dungeoneering reward
// products share the same server-authoritative grant-then-save pattern as raids,
// so they get the same exemption to avoid the identical wedge.
const MINIGAME_REWARD_ITEMS = new Set(
  (minigamesData?.tasks || []).flatMap(task => [
    task?.product,
    ...(Array.isArray(task?.rewardItems) ? task.rewardItems : []),
  ]).filter(Boolean)
)
const DUNGEONEERING_REWARD_ITEMS = new Set(
  ((skillsData?.dungeoneering?.actions) || [])
    .filter(action => action?.category === 'reward' && typeof action?.product === 'string')
    .map(action => action.product)
)

function isProtectedDeltaExempt(itemId) {
  if (!itemId) return true
  return MONSTER_DROP_ITEMS.has(itemId)
    || CLUE_REWARD_ITEMS.has(itemId)
    || RAID_REWARD_ITEMS.has(itemId)
    || MINIGAME_REWARD_ITEMS.has(itemId)
    || DUNGEONEERING_REWARD_ITEMS.has(itemId)
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
