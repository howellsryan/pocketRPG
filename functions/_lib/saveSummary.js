// Derives the small set of fields the server needs to keep on `characters`
// (total_level, combat_level) so leaderboard / CB lookups can run as cheap
// indexed SELECTs instead of LEFT JOINing `saves` and JSON.parsing a full
// save blob inside the Worker.
//
// Source of truth lives in the save blob itself. Whenever the client PUTs
// /api/save, we recompute these here and write them back to `characters`
// in the same D1 batch.

import { getLevelFromXP } from '../../src/engine/experience.js'
import { getCombatLevelFromSave } from './combatLevel.js'

function readLevelFromStat(statValue) {
  if (statValue == null) return 0
  if (typeof statValue === 'number') {
    return Number.isFinite(statValue) && statValue > 0 ? Math.floor(statValue) : 0
  }
  const explicit = Number(statValue.level)
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit)
  const xp = Number(statValue.xp)
  if (Number.isFinite(xp) && xp >= 0) return getLevelFromXP(xp)
  return 0
}

export function getTotalLevelFromSave(save) {
  if (!save || typeof save !== 'object') return 0
  const stats = save.stats
  if (!stats || typeof stats !== 'object') return 0
  let total = 0
  for (const value of Object.values(stats)) {
    total += readLevelFromStat(value)
  }
  return total
}

export function computeSaveSummary(save) {
  return {
    totalLevel: getTotalLevelFromSave(save),
    combatLevel: getCombatLevelFromSave(save),
  }
}

export function computeSaveSummaryFromJson(saveDataString) {
  if (typeof saveDataString !== 'string' || !saveDataString) {
    return { totalLevel: 0, combatLevel: 3 }
  }
  try {
    return computeSaveSummary(JSON.parse(saveDataString))
  } catch {
    return { totalLevel: 0, combatLevel: 3 }
  }
}
