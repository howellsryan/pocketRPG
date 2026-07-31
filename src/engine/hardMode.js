/**
 * Hard Mode: one authored flag per boss/raid, one scaling pass over the monster
 * record, and nothing else.
 *
 * Deliberately NOT a second copy of a monster in monsters.json and NOT a branch
 * inside combat.js: every fight in the game is built from a monster record plus
 * the monsters table (combat.js createCombatState, coopBossEngine
 * createCoopBossState), so scaling those two inputs at the door gives the
 * doubled HP, max hit, accuracy and defence for free — the damage, accuracy and
 * form code never learns hard mode exists.
 *
 * Drops are the exception on purpose: `drops` is left untouched here because
 * doubling a drop rate is a §14 server decision (hardModeDropChance, called only
 * from the server-side reward rollers). A client that scales a monster must not
 * be able to scale its own loot table.
 *
 * Pure logic, no UI imports.
 */

/** HP, every combat stat and every combat bonus multiply by this. */
export const HARD_MODE_SCALE = 2

/** Numeric fields on a monster (or one of its forms) that ARE combat stats. */
const HARD_MODE_SCALED_FIELDS = [
  'hitpoints', 'currentHP', 'attackBonus', 'strengthBonus', 'maxHit', 'formMaxHit', 'phaseHP',
  // Not a combat stat: the credits that BUY this kill. A skip grants the kill's
  // drops without the fight, so leaving it alone would make hard mode a strictly
  // better deal for anyone skipping — same price, double the rates. The server
  // charges the same multiple from its own state (functions/api/skip-hour.js);
  // this is the number the confirmation prompt shows.
  'skipCost',
]

function scaledNumber(value) {
  return Number.isFinite(value) ? Math.floor(value * HARD_MODE_SCALE) : value
}

function scaledMap(source) {
  if (!source || typeof source !== 'object') return source
  const out = {}
  for (const [key, value] of Object.entries(source)) out[key] = scaledNumber(value)
  return out
}

/** Content-authored eligibility: a monster or raid opts in, nothing is implicit. */
export function supportsHardMode(entity) {
  return entity?.hardMode === true
}

/**
 * A hard-mode copy of a monster definition. Idempotent — `hardModeActive` marks
 * an already-scaled record, because the active task persists its monster and
 * would otherwise be doubled again on every reload.
 */
export function scaleMonsterForHardMode(monster) {
  if (!monster || monster.hardModeActive) return monster
  const scaled = { ...monster, hardModeActive: true }
  for (const field of HARD_MODE_SCALED_FIELDS) {
    if (Number.isFinite(monster[field])) scaled[field] = scaledNumber(monster[field])
  }
  if (monster.stats) scaled.stats = scaledMap(monster.stats)
  if (monster.defenceBonus) scaled.defenceBonus = scaledMap(monster.defenceBonus)
  // A form carries its own bonuses and (for a phased boss) its own health bar,
  // and applyForm writes them straight over the monster mid-fight — an unscaled
  // form is a phase that reverts the boss to normal difficulty.
  if (monster.forms && typeof monster.forms === 'object') {
    const forms = {}
    for (const [key, form] of Object.entries(monster.forms)) {
      if (!form || typeof form !== 'object') {
        forms[key] = form
        continue
      }
      const next = { ...form }
      for (const field of HARD_MODE_SCALED_FIELDS) {
        if (Number.isFinite(form[field])) next[field] = scaledNumber(form[field])
      }
      if (form.defenceBonus) next.defenceBonus = scaledMap(form.defenceBonus)
      forms[key] = next
    }
    scaled.forms = forms
  }
  return scaled
}

// Scaling the whole table is what carries hard mode into the places that look a
// monster up by id mid-fight — the next raid boss, a boss's adds, a co-op
// respawn — without those call sites knowing anything about it. Memoised per
// table object: the table is a module import, so this runs once.
const hardModeTableCache = new WeakMap()

/** The monsters table with every entry scaled. Same shape, same ids. */
export function hardModeMonstersData(monstersData) {
  if (!monstersData || typeof monstersData !== 'object') return monstersData
  const cached = hardModeTableCache.get(monstersData)
  if (cached) return cached
  const out = {}
  for (const [id, monster] of Object.entries(monstersData)) out[id] = scaleMonsterForHardMode(monster)
  hardModeTableCache.set(monstersData, out)
  return out
}

/** The table a fight should use: scaled only when this fight is hard. */
export function monstersTableFor(monstersData, hardMode) {
  return hardMode ? hardModeMonstersData(monstersData) : monstersData
}

/** The credits a hard fight costs to skip: the kill is worth double, so is its price. */
export function hardModeSkipCost(cost, hardMode) {
  const base = Math.max(1, Math.floor(Number(cost) || 1))
  return hardMode ? base * HARD_MODE_SCALE : base
}

/**
 * A drop's chance in hard mode. Clamped at 1 — a guaranteed drop stays one drop,
 * it does not become two. Called ONLY by the server-side reward rollers.
 */
export function hardModeDropChance(chance, hardMode) {
  const base = Number(chance)
  if (!Number.isFinite(base)) return 0
  if (!hardMode) return base
  return Math.min(1, base * HARD_MODE_SCALE)
}
