import { MAX_LEVEL, MAX_XP } from '../utils/constants.js'

// Pre-compute XP table using exact level formula
// totalXP(L) = floor( sum(x=1 to L-1) of floor(x + 300 * 2^(x/7)) / 4 )
const XP_TABLE = new Array(MAX_LEVEL + 1)
XP_TABLE[1] = 0

function buildXPTable() {
  let cumulative = 0
  for (let level = 1; level < MAX_LEVEL; level++) {
    cumulative += Math.floor(level + 300 * Math.pow(2, level / 7))
    XP_TABLE[level + 1] = Math.floor(cumulative / 4)
  }
}
buildXPTable()

/**
 * Get total XP required for a given level
 */
export function getXPForLevel(level) {
  if (level < 1) return 0
  if (level > MAX_LEVEL) return XP_TABLE[MAX_LEVEL]
  return XP_TABLE[level]
}

/**
 * Get level from total XP (binary search)
 */
export function getLevelFromXP(xp) {
  if (xp < 0) return 1
  let lo = 1, hi = MAX_LEVEL
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (XP_TABLE[mid] <= xp) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * XP remaining to reach the next level
 */
export function getXPToNextLevel(currentXP) {
  const level = getLevelFromXP(currentXP)
  if (level >= MAX_LEVEL) return 0
  return XP_TABLE[level + 1] - currentXP
}

/**
 * Progress fraction (0-1) toward next level
 */
export function getLevelProgress(currentXP) {
  const level = getLevelFromXP(currentXP)
  if (level >= MAX_LEVEL) return 1
  const thisLevelXP = XP_TABLE[level]
  const nextLevelXP = XP_TABLE[level + 1]
  return (currentXP - thisLevelXP) / (nextLevelXP - thisLevelXP)
}

/**
 * Clamp XP to max
 */
export function clampXP(xp) {
  return Math.min(xp, MAX_XP)
}

export { XP_TABLE }
