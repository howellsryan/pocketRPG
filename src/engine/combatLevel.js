/**
 * Combat level — single source of truth.
 *
 * This is the ONLY place the combat-level formula should live. Client UI
 * (`src/utils/helpers.js`, quest eligibility) and the server
 * (`functions/_lib/combatLevel.js`) all delegate here so the number can never
 * drift between the two. The module is dependency-light (only `experience.js`,
 * which pulls no UI) so Pages Functions can import it directly.
 *
 * Formula (OSRS parity): a base from defence/hitpoints/prayer plus the highest
 * of the melee / ranged / magic contributions. The result is floored to a
 * minimum of 3 — the lowest combat level a character can have — matching the
 * server's PvP matchmaking snapshot.
 */

import { getLevelFromXP } from './experience.js'

const MIN_COMBAT_LEVEL = 3

/**
 * Compute combat level from raw skill LEVELS.
 * @param {Record<string, number>} levels - e.g. { attack, strength, defence, hitpoints, ranged, magic, prayer }
 */
export function combatLevelFromLevels(levels) {
  const lvl = (skill) => Number(levels?.[skill]) || 0
  const atk = lvl('attack')
  const str = lvl('strength')
  const def = lvl('defence')
  const hp = lvl('hitpoints')
  const pray = lvl('prayer')
  const ranged = lvl('ranged')
  const magic = lvl('magic')

  const base = 0.25 * (def + hp + Math.floor(pray / 2))
  const melee = 0.325 * (atk + str)
  const range = 0.325 * (Math.floor(ranged / 2) + ranged)
  const mage = 0.325 * (Math.floor(magic / 2) + magic)

  return Math.max(MIN_COMBAT_LEVEL, Math.floor(base + Math.max(melee, range, mage)))
}

/**
 * Compute combat level from a stats object keyed by `{ [skill]: { xp } }`
 * (the shape stored on a save). XP is converted to a level first.
 * @param {Record<string, { xp?: number }>} stats
 */
export function combatLevelFromStats(stats) {
  const levels = {}
  for (const skill of ['attack', 'strength', 'defence', 'hitpoints', 'prayer', 'ranged', 'magic']) {
    levels[skill] = getLevelFromXP(stats?.[skill]?.xp || 0)
  }
  return combatLevelFromLevels(levels)
}
