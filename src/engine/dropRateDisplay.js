/**
 * The drop rate a player is actually rolling against, for display.
 *
 * Two modifiers move a drop's odds and neither is authored into the table: Hard
 * Mode doubles them for the boss or raid it is switched on for, and Grindman
 * triples them for the whole account. The reward rollers compose them in one
 * expression (functions/_lib/game/monsterRewards.js, raidRewards.js) and this is
 * the same expression, so a rate the info sheet prints is the rate the server
 * rolls. Displaying the authored number instead told a Grindman on a hard boss
 * 1 in 512 for a drop they were getting at 1 in 85.
 *
 * Display only — nothing here decides a drop. Hard Mode's doubling stays a §14
 * server decision; this reads the flag the fight was built with.
 *
 * Pure logic, no UI imports.
 */

import { hardModeDropChance, HARD_MODE_MULTIPLIERS } from './hardMode.js'
import { grindmanDropChance, GRINDMAN_MULTIPLIERS } from './grindman.js'

/**
 * A drop's chance as it will be rolled. Order matches the rollers exactly, so
 * both clamps land in the same places theirs do.
 */
export function displayedDropChance(chance, { hardMode = false, grindman = false } = {}) {
  return grindmanDropChance(hardModeDropChance(chance, hardMode), grindman)
}

/** What the odds are multiplied by before the clamp: 1, 2, 3 or 6. */
export function dropRateMultiplier({ hardMode = false, grindman = false } = {}) {
  return (hardMode ? HARD_MODE_MULTIPLIERS.dropRate : 1) * (grindman ? GRINDMAN_MULTIPLIERS.dropRate : 1)
}

/**
 * The boost a monster's own drop table is displayed under.
 *
 * Hard mode is read off the RECORD, never a monsters.json lookup — the fight is
 * built from the scaled copy and `hardModeActive` is the only honest answer to
 * "was this fight hard" (§4). A raid boss is the exception: its table is never
 * rolled, because a raid pays once from the raid's own reward table (§21), so it
 * is shown as authored and claims no boost.
 */
export function monsterDropBoost(monster, grindman = false) {
  if (monster?.raidBoss === true) return { hardMode: false, grindman: false }
  return { hardMode: monster?.hardModeActive === true, grindman: grindman === true }
}

/**
 * The one line that explains why these numbers are not the authored ones, or
 * null when they are — an unboosted player must not be shown a badge that says
 * nothing.
 */
export function dropRateBoostLabel({ hardMode = false, grindman = false } = {}) {
  const multiplier = dropRateMultiplier({ hardMode, grindman })
  if (multiplier === 1) return null
  const sources = []
  if (hardMode) sources.push('Hard Mode')
  if (grindman) sources.push('Grindman')
  return `${sources.join(' + ')} — ${multiplier}× drop rates`
}
