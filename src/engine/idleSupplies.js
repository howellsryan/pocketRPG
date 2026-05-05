/**
 * Idle Supplies — pure helpers shared between the Combat screen UI and the
 * idle-combat simulation. These helpers are deliberately data-driven (read
 * metadata off the items/prayers JSON) so we don't hard-code item ids inside
 * the engine simulation.
 */

import { applyPotionBonuses, applyPrayerBonuses } from './combat.js'

const IDLE_SUPPLIES_TICK_MS = 600
const POTION_DURATION_TICKS_DEFAULT = 500 // 5 minutes at 600ms/tick

const BOOST_EFFECTS = new Set(['attack', 'strength', 'defence', 'combat', 'ranged', 'magic'])
const PRAYER_RESTORE_EFFECTS = new Set(['prayer', 'super_restore'])

const PRAYER_RESTORE_DEFAULT = {
  prayer: 15,
  super_restore: 20,
}

export function isFoodItem(item) {
  return !!item && item.type === 'food' && Number(item.heals) > 0
}

export function getFoodHealAmount(item) {
  if (!isFoodItem(item)) return 0
  return Math.max(0, Math.floor(Number(item.heals) || 0))
}

export function isPotionItem(item) {
  return !!item && item.type === 'potion'
}

export function isBoostPotion(item) {
  return isPotionItem(item) && BOOST_EFFECTS.has(item.effect)
}

export function isPrayerRestorePotion(item) {
  return isPotionItem(item) && PRAYER_RESTORE_EFFECTS.has(item.effect)
}

/**
 * Number of prayer points a single restore potion adds to the session pool.
 * Falls back to the per-effect default if the item omits explicit metadata.
 */
export function getPrayerRestoreAmount(item) {
  if (!isPrayerRestorePotion(item)) return 0
  if (Number.isFinite(Number(item.idlePrayerRestore))) {
    return Math.max(0, Math.floor(Number(item.idlePrayerRestore)))
  }
  return PRAYER_RESTORE_DEFAULT[item.effect] || 0
}

/**
 * Boost-potion duration in ticks. Defaults to 500 ticks (5 min) per potion,
 * or item.duration (seconds) if provided.
 */
export function getBoostPotionDurationTicks(item) {
  if (!isBoostPotion(item)) return 0
  const seconds = Number(item.duration)
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(1, Math.floor((seconds * 1000) / IDLE_SUPPLIES_TICK_MS))
  }
  return POTION_DURATION_TICKS_DEFAULT
}

/**
 * Default empty idle-combat setup. Used as the starting value when nothing
 * has been persisted yet.
 */
export function defaultIdleCombatSetup() {
  return {
    food: [],         // [{ itemId, quantity }]
    potions: [],      // [{ itemId, quantity }] — multi-select; first entries consumed first
    prayers: {
      protectionPrayerId: null,
      combatPrayerId: null,
    },
  }
}

/**
 * Sanitise a raw setup blob from disk/cloud so unknown fields can't crash the
 * simulator or UI. Drops invalid entries; clamps quantities to non-negative
 * integers; ignores duplicate itemIds in the food/potion lists.
 */
export function normaliseIdleCombatSetup(raw) {
  const base = defaultIdleCombatSetup()
  if (!raw || typeof raw !== 'object') return base

  const seenFood = new Set()
  const food = Array.isArray(raw.food) ? raw.food.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const itemId = String(entry.itemId || '')
    const quantity = Math.max(0, Math.floor(Number(entry.quantity) || 0))
    if (!itemId || quantity <= 0 || seenFood.has(itemId)) return []
    seenFood.add(itemId)
    return [{ itemId, quantity }]
  }) : []

  const seenPotion = new Set()
  const potions = Array.isArray(raw.potions) ? raw.potions.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const itemId = String(entry.itemId || '')
    const quantity = Math.max(0, Math.floor(Number(entry.quantity) || 0))
    if (!itemId || quantity <= 0 || seenPotion.has(itemId)) return []
    seenPotion.add(itemId)
    return [{ itemId, quantity }]
  }) : []

  const prayers = raw.prayers && typeof raw.prayers === 'object' ? raw.prayers : {}
  const protectionPrayerId = typeof prayers.protectionPrayerId === 'string' ? prayers.protectionPrayerId : null
  const combatPrayerId = typeof prayers.combatPrayerId === 'string' ? prayers.combatPrayerId : null

  return {
    food,
    potions,
    prayers: { protectionPrayerId, combatPrayerId },
  }
}

/**
 * Validate a prayer selection against player level and prayer metadata.
 * Returns { protectionPrayerId, combatPrayerId } with invalid entries dropped.
 */
export function getValidIdlePrayerSelection(prayers, prayersData, prayerLevel) {
  const out = { protectionPrayerId: null, combatPrayerId: null }
  if (!prayers || !prayersData) return out
  const lvl = Math.max(1, Math.floor(Number(prayerLevel) || 1))

  const protId = prayers.protectionPrayerId
  if (protId && prayersData[protId]) {
    const p = prayersData[protId]
    if (p.bonusType === 'protection' && (p.level || 1) <= lvl) {
      out.protectionPrayerId = protId
    }
  }

  const cmbId = prayers.combatPrayerId
  if (cmbId && prayersData[cmbId]) {
    const p = prayersData[cmbId]
    const isCombatPrayer = p.bonusType === 'stat' || p.bonusType === 'multi_stat'
    if (isCombatPrayer && (p.level || 1) <= lvl) {
      out.combatPrayerId = cmbId
    }
  }

  return out
}

/**
 * Count how many of `itemId` are available across inventory + bank.
 */
export function countAvailable(itemId, inventory = [], bank = {}) {
  if (!itemId) return 0
  let n = 0
  for (const slot of inventory) {
    if (slot && slot.itemId === itemId && !slot.noted) n += slot.quantity || 0
  }
  if (bank && bank[itemId]) n += bank[itemId].quantity || 0
  return n
}

/**
 * Mutate the inventory + bank deduction map for a given consumption count.
 * Inventory is mutated in-place (slots become null when emptied); bank
 * deductions are returned in `bankConsumed` so the caller can apply them.
 *
 * Returns the number actually consumed (≤ requested).
 */
export function consumeFromInventoryThenBank(itemId, requested, inventory, bank, bankConsumed) {
  let remaining = Math.max(0, Math.floor(requested))
  if (remaining <= 0) return 0
  let consumed = 0
  for (let i = 0; i < inventory.length && remaining > 0; i++) {
    const slot = inventory[i]
    if (!slot || slot.itemId !== itemId || slot.noted) continue
    const take = Math.min(slot.quantity || 0, remaining)
    if (take <= 0) continue
    inventory[i] = { ...slot, quantity: slot.quantity - take }
    if (inventory[i].quantity <= 0) inventory[i] = null
    remaining -= take
    consumed += take
  }
  if (remaining > 0 && bank && bank[itemId]) {
    const have = bank[itemId].quantity || 0
    const take = Math.min(have, remaining)
    if (take > 0) {
      bankConsumed[itemId] = (bankConsumed[itemId] || 0) + take
      remaining -= take
      consumed += take
    }
  }
  return consumed
}

/**
 * Build a sanitised supply pool keyed by itemId, capped against real
 * inventory + bank availability. Used by the simulator so configured but
 * missing supplies never grant a benefit.
 */
export function buildAvailableSupplyMap(supplyList, inventory, bank) {
  const out = {}
  if (!Array.isArray(supplyList)) return out
  for (const entry of supplyList) {
    if (!entry?.itemId) continue
    const configured = Math.max(0, Math.floor(Number(entry.quantity) || 0))
    if (configured <= 0) continue
    const available = Math.min(configured, countAvailable(entry.itemId, inventory, bank))
    out[entry.itemId] = { configured, available }
  }
  return out
}

/**
 * Apply boost potion + combat prayer to the base player stats. Both layers
 * are optional — pass nulls/undefined when the supply has expired.
 */
export function buildBoostedPlayerStats(baseStats, boostPotionItem, combatPrayerId, prayersData) {
  let s = { ...baseStats }
  if (combatPrayerId && prayersData) {
    s = applyPrayerBonuses(s, combatPrayerId, prayersData) || s
  }
  if (boostPotionItem) {
    s = applyPotionBonuses(s, boostPotionItem) || s
  }
  return s
}
