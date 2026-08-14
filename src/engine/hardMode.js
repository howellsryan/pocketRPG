/**
 * Hard Mode: one authored flag per boss/raid, one scaling pass over the monster
 * record, and nothing else.
 *
 * Deliberately NOT a second copy of a monster in monsters.json and NOT a branch
 * inside combat.js: every fight in the game is built from a monster record plus
 * the monsters table (combat.js createCombatState, coopBossEngine
 * createCoopBossState), so scaling those two inputs at the door gives the
 * doubled max hit and accuracy for free — the damage, accuracy and form code
 * never learns hard mode exists.
 *
 * Drops are the exception on purpose: `drops` is left untouched here because
 * doubling a drop rate is a §14 server decision (hardModeDropChance, called only
 * from the server-side reward rollers). A client that scales a monster must not
 * be able to scale its own loot table.
 *
 * Pure logic, no UI imports.
 */

/**
 * Every number Hard Mode moves, in one place. Retune the fight from here.
 *
 * `hitpoints` and `defence` are both deliberately 1: the boss dies to the same
 * hits in the same time it always did, and only what it does to YOU changes.
 * That is the shape of the mode — more danger per second, not a longer fight.
 * Raising either turns it into a damage sponge, which is why they are named
 * dials rather than numbers buried in the scaling pass.
 */
export const HARD_MODE_MULTIPLIERS = {
  /** Health bar: hitpoints, and a phased boss's per-phase bar. */
  hitpoints: 1,
  /** Offence: max hit, attack/strength bonuses, and the levels behind them. */
  offence: 2,
  /** Defence: defence level and every defence bonus. */
  defence: 1,
  /** Every drop chance on the table (server-side only, clamped at 1). */
  dropRate: 2,
  /** Credits to buy the kill with a skip — a skip buys the doubled drop roll. */
  skipCost: 2,
}

/** Monster fields that are the health bar. */
const HITPOINT_FIELDS = ['hitpoints', 'currentHP', 'phaseHP']
/** Monster fields that are pure offence. */
const OFFENCE_FIELDS = ['maxHit', 'formMaxHit', 'attackBonus', 'strengthBonus']
/** Stat levels that only ever feed an attack roll or a damage roll. */
const OFFENCE_STATS = ['attack', 'strength', 'ranged']

function scaledBy(value, multiplier) {
  return Number.isFinite(value) ? Math.floor(value * multiplier) : value
}

/**
 * Whether this monster's magic level is an OFFENSIVE stat for it.
 *
 * `stats.magic` is the one dual-purpose number on a monster: it is the damage
 * and accuracy stat of a magic attacker, and it is also 70% of every monster's
 * magic defence roll (monsterMagicDefenceRoll). Scaling it blindly would hand a
 * melee boss a doubled magic defence — exactly the defensive buff this mode is
 * built to withhold. So it scales as offence only for a monster that actually
 * casts, in its base form or in any form it rotates through.
 */
function usesMagicOffensively(monster) {
  if (monster?.attackStyle === 'magic') return true
  const forms = monster?.forms
  if (!forms || typeof forms !== 'object') return false
  return Object.values(forms).some((form) => form?.attackStyle === 'magic')
}

function scaledStats(stats, magicIsOffensive) {
  if (!stats || typeof stats !== 'object') return stats
  const { offence, defence } = HARD_MODE_MULTIPLIERS
  const out = {}
  for (const [key, value] of Object.entries(stats)) {
    if (key === 'magic') out[key] = scaledBy(value, magicIsOffensive ? offence : defence)
    else if (OFFENCE_STATS.includes(key)) out[key] = scaledBy(value, offence)
    else out[key] = scaledBy(value, defence)
  }
  return out
}

function scaledDefenceBonus(bonus) {
  if (!bonus || typeof bonus !== 'object') return bonus
  const out = {}
  for (const [key, value] of Object.entries(bonus)) out[key] = scaledBy(value, HARD_MODE_MULTIPLIERS.defence)
  return out
}

function scaleFields(source, target) {
  for (const field of HITPOINT_FIELDS) {
    if (Number.isFinite(source[field])) target[field] = scaledBy(source[field], HARD_MODE_MULTIPLIERS.hitpoints)
  }
  for (const field of OFFENCE_FIELDS) {
    if (Number.isFinite(source[field])) target[field] = scaledBy(source[field], HARD_MODE_MULTIPLIERS.offence)
  }
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
  scaleFields(monster, scaled)
  // Not a combat stat: the credits that BUY this kill. A skip grants the kill's
  // drops without the fight, so leaving it alone would make hard mode a strictly
  // better deal for anyone skipping — same price, double the rates. The server
  // charges the same multiple from its own state (functions/api/skip-hour.js);
  // this is the number the confirmation prompt shows.
  if (Number.isFinite(monster.skipCost)) scaled.skipCost = scaledBy(monster.skipCost, HARD_MODE_MULTIPLIERS.skipCost)
  const magicIsOffensive = usesMagicOffensively(monster)
  if (monster.stats) scaled.stats = scaledStats(monster.stats, magicIsOffensive)
  if (monster.defenceBonus) scaled.defenceBonus = scaledDefenceBonus(monster.defenceBonus)
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
      scaleFields(form, next)
      if (form.defenceBonus) next.defenceBonus = scaledDefenceBonus(form.defenceBonus)
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
  return hardMode ? Math.floor(base * HARD_MODE_MULTIPLIERS.skipCost) : base
}

/**
 * A drop's chance in hard mode. Clamped at 1 — a guaranteed drop stays one drop,
 * it does not become two. Called ONLY by the server-side reward rollers.
 */
export function hardModeDropChance(chance, hardMode) {
  const base = Number(chance)
  if (!Number.isFinite(base)) return 0
  if (!hardMode) return base
  return Math.min(1, base * HARD_MODE_MULTIPLIERS.dropRate)
}

/**
 * Whether one item survives a hard-mode death.
 *
 * Untradeables do. An Infernal Cape, a quest reward, a skill cape cannot be
 * bought back at any price, so losing one is not a setback the player can play
 * their way out of — it ends the account's relationship with that content. The
 * risk hard mode sells is the gear and supplies you can replace.
 *
 * COINS are the one exception to the exception: items.json flags them
 * isUntradeable for the general-store engine (the same artefact PvP loot
 * special-cases in lootTransfer.js), and coins are the most replaceable thing
 * in the game. They burn with the rest of the pack.
 */
export function survivesHardModeDeath(itemId, itemsData) {
  if (typeof itemId !== 'string' || !itemId || itemId === 'coins') return false
  return itemsData?.[itemId]?.isUntradeable === true
}

/**
 * What a hard-mode death costs: everything tradeable carried and worn, gone for
 * good. Untradeables stay exactly where they are, in the slot they were in. The
 * BANK is untouched — the risk is what you took in with you, so the counter-play
 * is to take in less.
 *
 * Returns the surviving pack and the tally of what was lost, so the death screen
 * can name it rather than leaving the player to work out what happened. An item
 * this table has never heard of is treated as tradeable and lost, which is the
 * conservative reading of a mode whose whole premise is that it takes things.
 */
export function hardModeDeathLoss(inventory, equipment, itemsData) {
  const lost = []
  // `charges` is carried so the Grim Reaper stash (src/engine/grimReaper.js)
  // can hand a reclaimed scythe/trident/blowpipe back with what was left in
  // it — omitted rather than zeroed when there's nothing to carry, the same
  // absent-means-untouched shape as the bank's own charge pool (§4).
  const tally = (itemId, quantity, charges) => {
    const qty = Math.max(0, Math.floor(Number(quantity) || 0)) || 1
    const chg = Math.max(0, Math.floor(Number(charges) || 0))
    const existing = lost.find((entry) => entry.itemId === itemId)
    if (existing) {
      existing.quantity += qty
      if (chg > 0) existing.charges = (existing.charges || 0) + chg
    } else {
      lost.push(chg > 0 ? { itemId, quantity: qty, charges: chg } : { itemId, quantity: qty })
    }
  }
  const slots = Array.isArray(inventory) ? inventory : []
  // A fixed-length pack, not a shorter array: the inventory is indexed by slot
  // everywhere it is read, and a kept item stays in the slot it was in.
  const keptInventory = slots.map((slot) => {
    const itemId = slot?.itemId
    if (typeof itemId !== 'string' || !itemId) return null
    if (survivesHardModeDeath(itemId, itemsData)) return slot
    tally(itemId, slot?.quantity, slot?.charges)
    return null
  })
  const keptEquipment = {}
  for (const [slotName, worn] of Object.entries(equipment && typeof equipment === 'object' ? equipment : {})) {
    const itemId = worn?.itemId
    if (typeof itemId !== 'string' || !itemId) continue
    if (survivesHardModeDeath(itemId, itemsData)) keptEquipment[slotName] = worn
    else tally(itemId, worn?.quantity, worn?.charges)
  }
  return { inventory: keptInventory, equipment: keptEquipment, lost }
}

/**
 * Whether a saved task's death is a hard-mode death.
 *
 * The active task persists the SCALED monster (that is what
 * `scaleMonsterForHardMode`'s idempotency guard is for), so the fight carries
 * its own difficulty into idle catch-up, offline boot and skip-1h — none of
 * which can read the player's current toggle, and none of which should: the
 * fight that killed them is the one that was running.
 */
export function idleTaskDiedHard(task) {
  return task?.type === 'combat' && task?.monster?.hardModeActive === true
}
