/**
 * Consumables — the single source of truth for how food and potions behave in
 * LIVE combat (both PvE `combat.js`/`CombatScreen` and server-authoritative PvP
 * `pvpEngine.js`). Before this module the two paths each had their own copies of
 * the eligibility checks, heal amounts, potion durations and stat-boost maths,
 * which drifted apart (PvP rejected brews/magic/prayer/restore potions and used
 * a different boost formula). Everything here is pure and data-driven so both
 * call sites stay in lockstep.
 *
 * NOTE: the idle simulation (`idleSupplies.js`) is a separate path with its own
 * prayer-point pool and bank-draw rules; it is intentionally not unified here.
 */

// Prayer points restored by drinking a restore potion mid-combat — shared with
// the prayer-drain module (one-way import; prayerDrain.js depends on nothing).
import { PRAYER_RESTORE_AMOUNTS } from './prayerDrain.js'

// Heal amount granted by eating a food/brew item (canonical `heals`, legacy `heal`).
export function getHealAmount(item) {
  const n = Number(item?.heals ?? item?.heal ?? 0)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

// A brew (e.g. Lumira Brew): a potion that heals on use and wipes active buffs.
export function isLumiraBrew(item) {
  return !!(item && item.type === 'potion' && item.wipesPotions)
}

// Eligible for the `eat` action: real food, or a brew (which heals when eaten).
export function isConsumableFood(item) {
  return !!item && (item.type === 'food' || isLumiraBrew(item))
}

// Eligible for the `drink_potion` action: any potion item.
export function isConsumablePotion(item) {
  return !!item && item.type === 'potion'
}

// A "combo" consumable can be used on the SAME tick as a normal food. This
// covers combo food (e.g. Karam, flagged `combo: true`) and EVERY potion —
// brews (which heal) and stat/restore potions alike. Combo items share a single
// combo cooldown so only one lands per tick, independent of the normal-food eat
// delay, and they do not delay the next attack. Used by both the PvE combat tick
// and the server-authoritative PvP engine so the rule stays in lockstep.
export function isComboConsumable(item) {
  if (!item) return false
  if (item.type === 'potion') return true
  return item.type === 'food' && item.combo === true
}

// Normal food obeys the eat delay (one per few ticks) and blocks the next
// attack. Combo food (Karam) is excluded.
export function isNormalFood(item) {
  return !!item && item.type === 'food' && item.combo !== true
}

// Buff duration in 600ms ticks. `item.duration` is in seconds (default 300s).
export function getPotionDurationTicks(item) {
  return Math.floor((Number(item?.duration) || 300) / 0.6)
}

// Combat ("super combat" family) potions are primarily melee, but in PocketRPG
// they also grant a secondary ranged & magic boost equal to the dedicated
// Ranging Potion (+14) and Magic Potion (+4) — so a combat potion is a true
// all-styles boost without out-boosting the specialist potions on those styles.
// Kept in lockstep with those items by tests/consumables.test.ts.
export const COMBAT_POTION_RANGED_BOOST = 14 // === Ranging Potion boost
export const COMBAT_POTION_MAGIC_BOOST = 4   // === Magic Potion boost

// Flat per-stat boost contributed by a single potion item (PvE `item.boost`
// model). Returns a partial { attack, strength, defence, ranged, magic } map;
// hp / prayer / super_restore contribute no stat boost.
export function getPotionStatBoost(item) {
  const boost = Number(item?.boost) || 0
  if (!boost) return {}
  switch (item?.effect) {
    case 'combat':   return { attack: boost, strength: boost, defence: boost, ranged: COMBAT_POTION_RANGED_BOOST, magic: COMBAT_POTION_MAGIC_BOOST }
    case 'attack':   return { attack: boost }
    case 'strength': return { strength: boost }
    case 'defence':  return { defence: boost }
    case 'ranged':   return { ranged: boost }
    case 'magic':    return { magic: boost }
    default:         return {}
  }
}

// Total additive stat boosts from all active potions, SUMMED across them (mirrors
// PvE, which applies each active potion's boost in turn). Different potions stack
// — an attack potion and a strength potion are both applied — and two potions
// boosting the same stat add together. Used by both the PvE tick and the PvP
// combat-modifier layer so the two stay in lockstep.
export function getActivePotionBoosts(activePotions, itemsData) {
  const totals = { attack: 0, strength: 0, defence: 0, ranged: 0, magic: 0 }
  if (!activePotions || typeof activePotions !== 'object' || !itemsData) return totals
  for (const [potionId, ticks] of Object.entries(activePotions)) {
    if ((ticks || 0) <= 0) continue
    const item = itemsData[potionId]
    if (!item) continue
    for (const [stat, val] of Object.entries(getPotionStatBoost(item))) {
      totals[stat] = (totals[stat] || 0) + val
    }
  }
  return totals
}

/**
 * Apply a consumable's immediate effect to a normalized combat actor
 * `{ hp, maxHP, activePotions }` (mutated in place). The caller owns inventory
 * decrement, cooldowns, attack-timer binding and logging — those legitimately
 * differ between PvE (immediate, client) and PvP (queued, server).
 *
 * @param kind 'eat' | 'drink'
 * @returns { healed, wiped, buffed }
 */
export function applyConsumableEffect(actor, item, itemId, kind) {
  if (!actor || !item) return { healed: 0, wiped: false, buffed: false }
  if (!actor.activePotions || typeof actor.activePotions !== 'object') actor.activePotions = {}
  const maxHP = Number(actor.maxHP) || 0

  // Brews heal and wipe all active buffs, regardless of eat/drink entry point.
  if (isLumiraBrew(item)) {
    const heal = Number(item.boost) || 10
    const before = actor.hp
    actor.hp = Math.min(maxHP, actor.hp + heal)
    for (const k of Object.keys(actor.activePotions)) delete actor.activePotions[k]
    return { healed: actor.hp - before, wiped: true, buffed: false }
  }

  if (kind === 'eat') {
    const heal = getHealAmount(item)
    const before = actor.hp
    actor.hp = Math.min(maxHP, actor.hp + heal)
    return { healed: actor.hp - before, wiped: false, buffed: false }
  }

  // Drink a potion: register its buff for the full duration. HP-effect potions
  // also heal immediately; prayer/super_restore potions refill the prayer pool
  // when the actor tracks one (live combat). Both effects fall through harmlessly
  // when the actor has no matching field.
  actor.activePotions[itemId] = getPotionDurationTicks(item)
  if (item.effect === 'hp') {
    const heal = Number(item.boost) || 10
    const before = actor.hp
    actor.hp = Math.min(maxHP, actor.hp + heal)
    return { healed: actor.hp - before, wiped: false, buffed: true }
  }
  const restore = PRAYER_RESTORE_AMOUNTS[item.effect] || 0
  if (restore > 0 && typeof actor.prayerPoints === 'number') {
    const max = Number(actor.maxPrayerPoints) || actor.prayerPoints
    const before = actor.prayerPoints
    actor.prayerPoints = Math.min(max, actor.prayerPoints + restore)
    return { healed: 0, wiped: false, buffed: true, prayerRestored: actor.prayerPoints - before }
  }
  return { healed: 0, wiped: false, buffed: true }
}
