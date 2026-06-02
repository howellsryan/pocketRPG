import { getTotalLevelFromSave } from '../saveSummary.js'

// Total-level regression guard. PocketRPG XP is monotonic — XP only ever
// increases (capped at 200M) and every skill level is derived from it (1–99),
// so there is NO legitimate gameplay path that lowers a character's total
// level. A save whose total level falls below the stored save is the
// signature of a fresh / "level 3" character being written over a real one
// (e.g. a boot that mistook a failed cloud read for "no save yet" and flushed
// a new game). Callers reject the write so that class of bug can never wipe a
// live character. A null/empty next save counts as total level 0.
export function detectTotalLevelRegression(previousSave = {}, nextSave = {}) {
  const previousTotalLevel = getTotalLevelFromSave(previousSave)
  const nextTotalLevel = getTotalLevelFromSave(nextSave)
  return {
    regressed: nextTotalLevel < previousTotalLevel,
    previousTotalLevel,
    nextTotalLevel,
  }
}
