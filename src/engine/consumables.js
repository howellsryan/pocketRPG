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

// Buff duration in 600ms ticks. `item.duration` is in seconds (default 300s).
export function getPotionDurationTicks(item) {
  return Math.floor((Number(item?.duration) || 300) / 0.6)
}

// Flat per-stat boost contributed by a single potion item (PvE `item.boost`
// model). Returns a partial { attack, strength, defence, ranged, magic } map;
// hp / prayer / super_restore contribute no stat boost.
export function getPotionStatBoost(item) {
  const boost = Number(item?.boost) || 0
  if (!boost) return {}
  switch (item?.effect) {
    case 'combat':   return { attack: boost, strength: boost, defence: boost, ranged: boost, magic: boost }
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
  // also heal immediately. Non-boosting potions (prayer/super_restore) are
  // consumed for no mechanical effect, matching live PvE.
  actor.activePotions[itemId] = getPotionDurationTicks(item)
  if (item.effect === 'hp') {
    const heal = Number(item.boost) || 10
    const before = actor.hp
    actor.hp = Math.min(maxHP, actor.hp + heal)
    return { healed: actor.hp - before, wiped: false, buffed: true }
  }
  return { healed: 0, wiped: false, buffed: true }
}
