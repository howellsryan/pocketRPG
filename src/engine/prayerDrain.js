/**
 * Prayer drain — the single source of truth for the prayer-point pool in LIVE
 * combat, shared by the PvE combat tick (`combat.js`) and the server-authoritative
 * PvP engine (`pvpEngine.js`). OSRS-influenced: the pool maxes at the player's
 * Prayer level, each active prayer drains points over time (higher-tier prayers
 * drain faster), and when the pool empties every active prayer switches off.
 *
 * The idle simulation keeps its own separate prayer-point model in
 * `idleSupplies.js`; this module is for active combat only.
 */

// One 600ms combat tick — 100 ticks per minute, so per-minute drain rates
// (authored in prayers.json as `drainPerMinute`) convert to per-tick by /100.
export const PRAYER_TICKS_PER_MINUTE = 100

// Restore granted by drinking a restore potion mid-combat.
export const PRAYER_RESTORE_AMOUNTS = { prayer: 20, super_restore: 22 }

/** Max prayer points for a given Prayer level (OSRS: equal to the level). */
export function getMaxPrayerPoints(prayerLevel) {
  return Math.max(1, Math.floor(Number(prayerLevel) || 1))
}

/** Per-minute drain rate for one prayer id (0 when off/unknown). */
export function getPrayerDrainPerMinute(prayerId, prayersData) {
  const p = prayerId && prayersData ? prayersData[prayerId] : null
  return p ? Math.max(0, Number(p.drainPerMinute) || 0) : 0
}

/** Combined per-tick drain for a set of active prayer ids. */
export function getActivePrayerDrainPerTick(activePrayerIds, prayersData) {
  let perMinute = 0
  for (const id of activePrayerIds || []) perMinute += getPrayerDrainPerMinute(id, prayersData)
  return perMinute / PRAYER_TICKS_PER_MINUTE
}

/** Restore points a given restore potion adds (0 for non-restore potions). */
export function getPrayerRestoreFromPotion(item) {
  if (!item || item.type !== 'potion') return 0
  return PRAYER_RESTORE_AMOUNTS[item.effect] || 0
}

/**
 * Advance the prayer pool by one tick on a state-like object carrying
 * `prayerPoints`, `prayerDrainAccumulator`, `activeProtectionPrayer` and/or
 * `activeCombatPrayer` (mutated in place). No-op until `prayerPoints` is a
 * number, so call sites that never set it (e.g. the idle sim) are unaffected.
 * `drainMultiplier` carries worn drain-reduction perks (Vigil sigil shield).
 * Returns true on the tick the pool empties (prayers were switched off).
 */
export function applyPrayerDrainTick(state, prayersData, drainMultiplier = 1) {
  if (!state || typeof state.prayerPoints !== 'number') return false
  const raw = Number(drainMultiplier)
  const multiplier = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1
  const drain = getActivePrayerDrainPerTick([state.activeProtectionPrayer, state.activeCombatPrayer], prayersData) * multiplier
  if (drain <= 0) return false
  state.prayerDrainAccumulator = (state.prayerDrainAccumulator || 0) + drain
  if (state.prayerDrainAccumulator >= 1) {
    const whole = Math.floor(state.prayerDrainAccumulator)
    state.prayerPoints = Math.max(0, state.prayerPoints - whole)
    state.prayerDrainAccumulator -= whole
  }
  if (state.prayerPoints <= 0) {
    state.prayerPoints = 0
    state.activeProtectionPrayer = null
    state.activeCombatPrayer = null
    return true
  }
  return false
}

/** Add restore points to a state's pool, capped at `maxPrayerPoints`. */
export function restorePrayerPoints(state, amount) {
  if (!state || typeof state.prayerPoints !== 'number') return 0
  const max = Number(state.maxPrayerPoints) || state.prayerPoints
  const before = state.prayerPoints
  state.prayerPoints = Math.min(max, state.prayerPoints + Math.max(0, Math.floor(amount)))
  return state.prayerPoints - before
}
