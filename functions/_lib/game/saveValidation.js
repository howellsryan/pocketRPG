import { isProtectedItem } from './rewards.js'
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

// --- Economy inflation detection ----------------------------------------
//
// Beyond protected-item detection, the save endpoint must reject any
// client-driven increase in the high-value, server-owned fields:
//
//   * stats[skill].xp        — XP per skill
//   * coins total            — sum of all coin slots in inventory + bank
//                              + equipment (coins are stackable)
//   * slayer.points          — slayer points (and settings mirror)
//   * dungeoneeringTokens    — dungeoneering tokens (and settings mirror)
//   * bossKillCounts[*]      — boss kill counts (settings.bossKillCounts)
//   * raidKillCounts[*]      — raid kill counts (settings.raidKillCounts)
//   * unlockedMinigameItems  — set of unlocked minigame reward items
//
// These all have server-authoritative mutation paths (action completion,
// idle claim, protected reward claim, purchase). The save endpoint must
// not be a back-channel for inflating them.
//
// Returns a list of { path, prev, next, delta } objects; empty means no
// violations. Callers should reject the PUT with PROTECTED_STATE_DELTA
// when this is non-empty.

function readXpMap(save) {
  const map = new Map()
  const stats = save?.stats
  if (!stats || typeof stats !== 'object') return map
  for (const [skill, value] of Object.entries(stats)) {
    if (value == null) continue
    const xp = typeof value === 'number' ? value : Number(value?.xp)
    if (Number.isFinite(xp) && xp >= 0) map.set(skill, Math.floor(xp))
  }
  return map
}

function readCoinTotal(save) {
  let total = 0
  for (const slot of (save?.inventory || [])) {
    const id = slot?.itemId ?? slot?.id
    if (id === 'coins') total += Math.max(0, Math.floor(Number(slot?.quantity) || 0))
  }
  const bank = save?.bank && typeof save.bank === 'object' ? save.bank : {}
  const coinsBank = bank?.coins
  if (coinsBank != null) {
    const qty = typeof coinsBank === 'number' ? coinsBank : Number(coinsBank?.quantity)
    if (Number.isFinite(qty)) total += Math.max(0, Math.floor(qty))
  }
  return total
}

function readSlayerPoints(save) {
  const direct = Number(save?.slayer?.points)
  if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct)
  const settings = Number(save?.settings?.slayerPoints)
  if (Number.isFinite(settings) && settings >= 0) return Math.floor(settings)
  return 0
}

function readDungeoneeringTokens(save) {
  const top = Number(save?.dungeoneeringTokens)
  if (Number.isFinite(top) && top >= 0) return Math.floor(top)
  const settings = Number(save?.settings?.dungeoneeringTokens)
  if (Number.isFinite(settings) && settings >= 0) return Math.floor(settings)
  return 0
}

function readCounterMap(save, key) {
  const out = new Map()
  const map = save?.settings?.[key]
  if (!map || typeof map !== 'object') return out
  for (const [id, raw] of Object.entries(map)) {
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0) out.set(id, Math.floor(n))
  }
  return out
}

function readUnlockedMinigameItems(save) {
  const arr = save?.settings?.unlockedMinigameItems
  if (!Array.isArray(arr)) return new Set()
  return new Set(arr.filter((v) => typeof v === 'string' && v.length > 0))
}

export function detectEconomyInflation(previousSave = {}, nextSave = {}) {
  const violations = []

  // XP per skill
  const prevXp = readXpMap(previousSave)
  const nextXp = readXpMap(nextSave)
  for (const [skill, nextVal] of nextXp.entries()) {
    const prevVal = prevXp.get(skill) || 0
    if (nextVal > prevVal) violations.push({ path: `stats.${skill}.xp`, prev: prevVal, next: nextVal, delta: nextVal - prevVal })
  }

  // Coins
  const prevCoins = readCoinTotal(previousSave)
  const nextCoins = readCoinTotal(nextSave)
  if (nextCoins > prevCoins) violations.push({ path: 'coins', prev: prevCoins, next: nextCoins, delta: nextCoins - prevCoins })

  // Slayer points
  const prevSlayer = readSlayerPoints(previousSave)
  const nextSlayer = readSlayerPoints(nextSave)
  if (nextSlayer > prevSlayer) violations.push({ path: 'slayer.points', prev: prevSlayer, next: nextSlayer, delta: nextSlayer - prevSlayer })

  // Dungeoneering tokens
  const prevTokens = readDungeoneeringTokens(previousSave)
  const nextTokens = readDungeoneeringTokens(nextSave)
  if (nextTokens > prevTokens) violations.push({ path: 'dungeoneeringTokens', prev: prevTokens, next: nextTokens, delta: nextTokens - prevTokens })

  // Boss / raid kill counts
  for (const key of ['bossKillCounts', 'raidKillCounts']) {
    const prevMap = readCounterMap(previousSave, key)
    const nextMap = readCounterMap(nextSave, key)
    for (const [id, nextVal] of nextMap.entries()) {
      const prevVal = prevMap.get(id) || 0
      if (nextVal > prevVal) violations.push({ path: `settings.${key}.${id}`, prev: prevVal, next: nextVal, delta: nextVal - prevVal })
    }
  }

  // Unlocked minigame items
  const prevUnlocked = readUnlockedMinigameItems(previousSave)
  const nextUnlocked = readUnlockedMinigameItems(nextSave)
  for (const item of nextUnlocked) {
    if (!prevUnlocked.has(item)) violations.push({ path: 'settings.unlockedMinigameItems', prev: 0, next: 1, delta: 1, item })
  }

  return violations
}
