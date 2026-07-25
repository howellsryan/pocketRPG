// Shared monster-attack wind-up timing — the single source of truth for making a
// rigged monster's swing land its IMPACT frame on the engine's hit-splat tick,
// used by BOTH render paths so they align identically:
//   - the combat arena (src/components/CombatArena3D.jsx), and
//   - the open world (world/server/combat.ts pre-signals the swing; the world
//     client world/client/src/entities.ts starts the clip with the sub-tick delay).
//
// A baked attack clip's blow connects `attackImpactSec` into the clip (registry
// data, src/data/equipmentModels.json → getMonsterModel). Anim state only flips
// on 600ms tick boundaries, but the impact point rarely falls on one — so perfect
// alignment needs the swing to START `leadTicks` before the hit AND then be
// nudged by a sub-tick `startDelayMs`, so `startDelayMs + impact` lands exactly
// on the hit tick. `leadTicks = ceil(impactMs / tickMs)`; the remainder is the
// delay. Monsters with no impact metadata keep the coarse 1-tick lead / no delay.
//
// AUTHORING CONSTRAINT: a monster's `attackImpactSec` must be shorter than its
// attack cycle (attackSpeed * tickMs) — otherwise the wind-up can't fit before
// the swing lands. tests/combatWindup.test.ts guards the shipped values.

/** Per-monster wind-up derived from the clip's impact point. Returns the whole
 * number of ticks to lead the swing by and the sub-tick delay (ms) to offset the
 * clip start so its impact frame coincides with the hit tick. No/blank impact →
 * the coarse fallback (lead one tick, no delay). */
export function monsterAttackWindup(impactSec, tickMs) {
  if (impactSec == null || !(impactSec > 0) || !(tickMs > 0)) return { leadTicks: 1, startDelayMs: 0 }
  const impactMs = impactSec * 1000
  const leadTicks = Math.max(1, Math.ceil(impactMs / tickMs))
  return { leadTicks, startDelayMs: Math.max(0, leadTicks * tickMs - impactMs) }
}

/** Live, per-tick form used by the arena, which knows the exact ticks-until-hit
 * each tick: only the single tick whose remaining time is in [impact, impact+one
 * tick) can host the swing so its impact frame lands on the hit — earlier ticks
 * are too soon, later is too late. Returns the sub-tick start delay for that tick,
 * or null when this tick is not the one to launch on. `impactMs` is pre-clamped
 * to the clip duration by the caller. */
export function resolveWindupTick(ticksUntilHit, impactMs, tickMs) {
  const msUntilHit = ticksUntilHit * tickMs
  if (msUntilHit < impactMs || msUntilHit >= impactMs + tickMs) return null
  return { startDelayMs: Math.max(0, msUntilHit - impactMs) }
}
