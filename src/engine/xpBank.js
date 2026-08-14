/**
 * The one way XP enters a character's stats object.
 *
 * The account type's XP cut belongs HERE — downstream, where XP is committed —
 * and never in the combat engine upstream. XP reaches a save from combat,
 * skilling, quests, journeys, idle sims, the open world, co-op rooms and MCP
 * claims; the combat engine sees a fraction of that, so cutting there would
 * leave every other source paying full rate while double-cutting the one it
 * covers (grantXP and applyTaskResult already cut what the engine hands them).
 *
 * Returns what it BANKED, so a caller that also reports the gain — a level-up
 * tracker, a catch-up summary, a floating XP drop — shows the number that
 * reached the skill instead of the one it offered.
 *
 * Two writers deliberately do NOT come through here, and must not be "tidied"
 * into it: `grantXP` (src/state/gameState.jsx) is the same rule against React
 * state and owns the level-up toast, and `applyXpGainedToSave`
 * (functions/_lib/game/coopBoss.js) writes figures the co-op room already cut
 * per member — cutting them again would quarter a Grindman's group XP.
 */

import { grindmanXP } from './grindman.js'
import { getLevelFromXP } from './experience.js'

const XP_CAP = 200_000_000

/**
 * @param {Record<string, any>} stats  mutated in place
 * @param {string} skill
 * @param {number} amount  the gain BEFORE the account cut
 * @param {{ isGrindman?: boolean }} [opts]
 * @returns {number} XP actually added to the skill (0 at the cap, or when the
 *   cut rounds the gain away)
 */
export function bankXp(stats, skill, amount, { isGrindman = false } = {}) {
  if (!stats || !skill) return 0
  const offered = Math.floor(Number(amount) || 0)
  if (offered <= 0) return 0
  const banked = Math.floor(grindmanXP(offered, isGrindman === true))
  if (banked <= 0) return 0
  // A missing skill is initialised rather than dropped: a save created
  // server-side (MCP) may not carry every entry yet, and discarding the gain
  // there means levels never rise and requirements never unlock.
  const cur = stats[skill] || { skill, xp: 0, level: 1 }
  const before = Math.max(0, Number(cur.xp) || 0)
  const newXP = Math.min(before + banked, XP_CAP)
  stats[skill] = { ...cur, xp: newXP, level: getLevelFromXP(newXP) }
  return newXP - before
}
