/**
 * Grindman: an account mode that trades speed for drops. Half XP, triple drop
 * rates, and credits that can only be EARNED — never bought.
 *
 * Chosen at character creation and never revoked (unlike One Life, which flips
 * off on death), so nothing here takes a "turn it on" argument from a request:
 * `characters.is_grindman` is the server's own state and `player.is_grindman`
 * in the save is the client mirror, the same split Ironman and One Life use.
 *
 * Pure logic, no UI imports.
 */

/** Every number the mode moves. Retune the account type from here. */
export const GRINDMAN_MULTIPLIERS = {
  /** XP into every skill, from every source. */
  xp: 0.5,
  /** Every drop chance on a monster or raid reward table, clamped at 1. */
  dropRate: 3,
}

/** The mode flag as the save carries it. */
export function isGrindmanSave(save) {
  return save?.player?.is_grindman === true
}

/**
 * XP after the mode's cut. Floors, because XP is stored as an integer and a
 * fractional gain would otherwise round back up through clampXP's arithmetic —
 * a 1 XP gain is worth 0 to a Grindman, which is the honest reading of half.
 */
export function grindmanXP(amount, isGrindman) {
  const base = Number(amount)
  if (!Number.isFinite(base)) return 0
  if (!isGrindman) return base
  return Math.floor(base * GRINDMAN_MULTIPLIERS.xp)
}

/**
 * A drop's chance for a Grindman. Clamped at 1 for the same reason hard mode
 * clamps: a guaranteed drop stays one drop, it does not become three.
 */
export function grindmanDropChance(chance, isGrindman) {
  const base = Number(chance)
  if (!Number.isFinite(base)) return 0
  if (!isGrindman) return base
  return Math.min(1, base * GRINDMAN_MULTIPLIERS.dropRate)
}

/**
 * Whether a requested account type is a legal combination.
 *
 * Grindman stands alone: its whole shape is a slower grind paid back in drops,
 * and stacking it on Ironman's self-sufficiency or One Life's single death is a
 * different mode nobody designed. Enforced where the character is created, so a
 * conflicting pair never reaches the database.
 */
export function accountModeConflict({ isIronman = false, isOneLife = false, isGrindman = false } = {}) {
  if (!isGrindman) return null
  if (isIronman || isOneLife) return 'Grindman cannot be combined with Ironman or One Life.'
  return null
}

/**
 * The refusal every credit-purchase path gives a Grindman. One wording.
 *
 * Skips, slayer-task cancels and everything else credits buy stay open — the
 * mode's constraint is the SOURCE of the credits, not what they are spent on.
 * A Grindman's supply is the account's starting balance plus the one credit a
 * day the daily tasks pay, so every skip they take is one they earned.
 */
export const GRINDMAN_CREDITS_BLOCKED =
  'Grindman accounts cannot buy credits — yours come from daily tasks.'

/**
 * The refusal a Grindman gets for a collection-logged item on the trading post.
 *
 * The mode's whole shape is triple drop rates paid for with half XP, so a unique
 * that could be bought is a grind the account already skipped. It covers what a
 * logged drop BECOMES as well as the drop itself, so the refusal says "uniques"
 * rather than "collection log items" — an amulet of fury holds no log slot, but
 * buying one is buying the onyx. Buying is the only side refused — a Grindman
 * still sells what they grind — and the wording names the drop rather than the
 * market, because the point is where the item comes from, not what the trading
 * post is for.
 */
export const GRINDMAN_UNIQUES_GRINDED =
  'Grindman accounts grind their uniques — this one has to drop for you.'
