// Special-attack energy that comes back on the clock.
//
// The open world regenerates it as a session resource (§7); a solo or co-op
// fight regenerates none at all — it starts full and refills on a kill. The
// Master Rejuvenation construction perk doubles the world's rate, and because
// PvE has no rate of its own, the same doubled rate IS the perk out of the
// world: one number for the player to learn, 20 energy per 30 seconds.

export const SPECIAL_ENERGY_MAX = 100
export const SPECIAL_REGEN_INTERVAL_TICKS = 50
export const SPECIAL_REGEN_AMOUNT = 10
export const BASE_SPECIAL_REGEN_PER_TICK = SPECIAL_REGEN_AMOUNT / SPECIAL_REGEN_INTERVAL_TICKS

export const MASTER_REJUVENATION_ID = 'master_rejuvenation'
export const MASTER_REJUVENATION_MULTIPLIER = 2

/** Accepts either shape the unlock list takes: the client's Set or the save's array. */
export function hasMasterRejuvenation(unlockedFeatures) {
  if (!unlockedFeatures) return false
  if (typeof unlockedFeatures.has === 'function') return !!unlockedFeatures.has(MASTER_REJUVENATION_ID)
  return Array.isArray(unlockedFeatures) && unlockedFeatures.includes(MASTER_REJUVENATION_ID)
}

/** Energy per tick for one fight context. `baseRegenPerTick` is what the context
 * regenerates without the perk — the world's clock rate, or 0 anywhere in PvE. */
export function specialRegenPerTick(masterRejuvenation, baseRegenPerTick = 0) {
  const base = Number(baseRegenPerTick) > 0 ? Number(baseRegenPerTick) : 0
  if (!masterRejuvenation) return base
  return (base || BASE_SPECIAL_REGEN_PER_TICK) * MASTER_REJUVENATION_MULTIPLIER
}

/** Carries the fraction on the energy value itself, as the world already does —
 * every display of it floors (a bar reading 40.400000000000006% is the bug). */
export function regenSpecialEnergy(current, perTick) {
  const energy = Math.min(SPECIAL_ENERGY_MAX, Math.max(0, Number(current) || 0))
  if (!(perTick > 0) || energy >= SPECIAL_ENERGY_MAX) return energy
  return Math.min(SPECIAL_ENERGY_MAX, energy + perTick)
}

/** The same regen for a context whose energy crosses a wire: the fraction is
 * carried beside the value instead of on it, so the number only moves when a
 * whole point lands. A co-op room projects a member's combat state every tick
 * and skips the frame when nothing changed (§20) — a value that ticks up by
 * 0.4 changes on every single tick and defeats that. */
export function accrueSpecialEnergy(current, carry, perTick) {
  const energy = Math.min(SPECIAL_ENERGY_MAX, Math.max(0, Number(current) || 0))
  if (!(perTick > 0) || energy >= SPECIAL_ENERGY_MAX) return { energy, carry: 0 }
  const total = (Number(carry) || 0) + perTick
  const whole = Math.floor(total)
  return { energy: Math.min(SPECIAL_ENERGY_MAX, energy + whole), carry: total - whole }
}
