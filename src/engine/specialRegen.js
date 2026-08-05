// Master Rejuvenation (Construction Lv 90): the special bar snaps back to full
// the moment it empties. One rule, three contexts that each own their own copy
// of the energy — a solo fight, a co-op/raid member, an open-world session — so
// the predicate and the refill live here rather than being written out thrice.
//
// The open world is the one place it is switched off: the Wilderness (§10). A
// free bar every time it empties is a duel decided by who owns a perk.

export const SPECIAL_ENERGY_MAX = 100

export const MASTER_REJUVENATION_ID = 'master_rejuvenation'

/** Accepts either shape the unlock list takes: the client's Set or the save's array. */
export function hasMasterRejuvenation(unlockedFeatures) {
  if (!unlockedFeatures) return false
  if (typeof unlockedFeatures.has === 'function') return !!unlockedFeatures.has(MASTER_REJUVENATION_ID)
  return Array.isArray(unlockedFeatures) && unlockedFeatures.includes(MASTER_REJUVENATION_ID)
}

/** The perk itself: full energy once the bar is spent, the caller's value
 * otherwise. `enabled` is the perk AND whatever the context adds to it (the
 * world passes false in the Wilderness). */
export function refillSpecialOnEmpty(current, enabled) {
  const energy = Math.max(0, Number(current) || 0)
  if (!enabled || energy > 0) return energy
  return SPECIAL_ENERGY_MAX
}
