// PvP Bot AI — deterministic, pure, no I/O.
//
// computeBotIntents(state, botId, itemsData, profile) returns an array of
// intent objects (same shape processPvpTick expects) the bot should take
// this tick, in priority order.
//
// Decision pipeline (highest priority first):
//   1. Drink potion at fight start if none active
//   2. Eat if survival threshold breached and no eat cooldown
//   3. Offensive plan (only on a tick the bot can actually act):
//        a. KO push — if the equipped weapon's spec can finish the
//           opponent (or energy is capped on a cheap spec), queue it.
//        b. Weapon swap — if a finisher weapon in the bag could KO when
//           the equipped one can't, swap to it (the spec fires once it's
//           ready). Falls back to the highest-DPS weapon when no KO is on.
//   4. Prayer + stance — keep them matched to the weapon we'll be wielding.
//
// Why the off-by-one matters: the engine decrements attackTimer AFTER
// intents are applied, so a swing resolves on the tick where the bot
// enters with attackTimer <= 1. KO/spec decisions therefore gate on
// `willSwingThisTick` rather than `attackTimer === 0`, otherwise the bot
// would only ever spec on the opening tick.

import { getEquippedPvpSpecialAttack, clampPvpSpecialEnergy } from './pvpSpecialAttacks.js'
import { rollMeleeAttack, rollRangedAttack, rollMagicAttack } from './combatPrimitives.js'
import { getCombatType } from './equipment.js'

// Highest-DPS weapon(s) the bot returns to when no KO is being pursued,
// in preference order. Finisher weapons it swaps to for a kill attempt,
// cheapest / highest-burst first.
const PRIMARY_DPS_WEAPONS = ['magic_shortbow']
const KO_WEAPONS          = ['dragon_dagger', 'dragon_battleaxe']

// ── Internal helpers ──────────────────────────────────────────────────────────

function getBotCombatant(state, botId) {
  return state?.combatants?.[String(botId)] || null
}

function getOpponentCombatant(state, botId) {
  const ids = Object.keys(state?.combatants || {})
  const oppId = ids.find((id) => Number(id) !== Number(botId))
  return oppId ? state.combatants[oppId] : null
}

// Roll a max-hit snapshot for a combatant using the right combat style.
function rollMaxHitFor(combatant, opponent, itemsData) {
  try {
    const snap = combatant.combatType === 'ranged' ? rollRangedAttack(combatant, opponent, itemsData)
      : combatant.combatType === 'magic'  ? rollMagicAttack(combatant, opponent, itemsData)
      :                                     rollMeleeAttack(combatant, opponent, itemsData)
    return snap?.maxHit || 0
  } catch {
    return 0
  }
}

// Estimate max damage the bot can land in its current weapon configuration.
function estimateBotMaxHit(bot, opponent, itemsData) {
  return rollMaxHitFor(bot, opponent, itemsData)
}

// Estimate the biggest burst a given weapon could land on the opponent on
// a single action — used to decide whether a weapon (equipped or swapped
// to) can plausibly KO. Simulates the bot wielding `weaponId` with the
// correct combat style and damage prayer, then applies the spec multiplier.
function estimateWeaponBurst(weaponId, bot, opponent, itemsData) {
  const item = itemsData?.[weaponId]
  if (!item) return 0
  const fakeEquip   = { ...bot.equipment, weapon: { itemId: weaponId } }
  const combatType  = getCombatType(fakeEquip, itemsData)
  const fakeBot = {
    ...bot,
    equipment: fakeEquip,
    combatType,
    stance: combatType === 'ranged' ? 'rapid' : 'aggressive',
    activeCombatPrayer: bestDamagePrayer(combatType),
  }
  const base = rollMaxHitFor(fakeBot, opponent, itemsData)
  const spec = item.specialAttack
  if (!spec) return base   // no spec: a single high normal hit (e.g. battleaxe finisher)
  const dmgMult = Number(spec.maxHitMultiplier ?? spec.damageMultiplier ?? 0) || 0
  switch (spec.type) {
    case 'double_hit': return Math.floor(base * (dmgMult || 1.15)) * 2
    case 'snapshot':   return Math.floor(base * (dmgMult || 0.75)) * 2
    case 'overpower':  return Math.floor(base * (dmgMult || 1.5))
    default:           return base
  }
}

// Find a weapon in the bot's inventory by itemId; returns { inventorySlot, item }.
function findInventoryWeapon(bot, weaponId, itemsData) {
  const inv = bot.inventory || []
  for (let i = 0; i < inv.length; i++) {
    const slot = inv[i]
    if (slot?.itemId === weaponId) {
      const item = itemsData?.[weaponId]
      if (item?.slot === 'weapon') return { inventorySlot: i, item }
    }
  }
  return null
}

// Find food (manta_ray or any healable item) in inventory; returns slot index.
function findFoodSlot(bot, itemsData) {
  const inv = bot.inventory || []
  for (let i = 0; i < inv.length; i++) {
    const slot = inv[i]
    if (!slot) continue
    const item = itemsData?.[slot.itemId]
    if (item && (item.healsHP > 0 || item.id === 'manta_ray')) return i
  }
  // Fallback: look for any item flagged as food
  for (let i = 0; i < inv.length; i++) {
    const slot = inv[i]
    if (!slot) continue
    const item = itemsData?.[slot.itemId]
    if (item?.isFood || item?.healAmount > 0) return i
  }
  return -1
}

// Find a potion (super_combat or any pvp combat potion) in inventory.
function findPotionSlot(bot, itemsData) {
  const inv = bot.inventory || []
  const POTION_IDS = new Set(['super_combat', 'super_attack', 'super_strength', 'super_defence', 'combat_potion'])
  for (let i = 0; i < inv.length; i++) {
    const slot = inv[i]
    if (slot && POTION_IDS.has(slot.itemId)) return i
  }
  return -1
}

// Largest single-food heal sitting in the opponent's inventory — used to
// size how much extra burst is needed to kill them THROUGH an eat. Returns
// 0 if they have no food (so the bot won't waste specs on a foodless foe).
function opponentBestHeal(opponent, itemsData) {
  let best = 0
  for (const slot of opponent?.inventory || []) {
    if (!slot) continue
    const item = itemsData?.[slot.itemId]
    const heal = item ? (item.heals || item.healsHP || item.healAmount || 0) : 0
    if (heal > best) best = heal
  }
  return best
}

// Best prayer for a given combat type (no protection prayers in PvP v1).
function bestDamagePrayer(combatType) {
  if (combatType === 'ranged') return 'rigour'
  if (combatType === 'magic')  return 'augury'
  return 'piety'
}

// Stance that maximises offence for a combat type.
function bestOffensiveStance(combatType) {
  return combatType === 'ranged' ? 'rapid' : 'aggressive'
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Returns array of intent action objects for the bot this tick.
 * Empty array = no action (bot attacks normally via default swing).
 *
 * @param {object} state           - current PvP state snapshot
 * @param {number} botId           - the bot's character id
 * @param {object} itemsData       - items lookup (from pvpMatch.js)
 * @param {string} [profile]       - AI profile key (unused in v1; reserved)
 */
export function computeBotIntents(state, botId, itemsData) {
  const bot      = getBotCombatant(state, botId)
  const opponent = getOpponentCombatant(state, botId)
  if (!bot || !opponent) return []

  const intents = []

  // 1. Drink potion — at fight start or when boost has worn off.
  //    potionCooldown > 0 means we cannot drink yet.
  if ((bot.potionCooldown || 0) <= 0) {
    const hasPotionActive = Object.keys(bot.activePotions || {}).some(
      (pid) => (bot.activePotions[pid] || 0) > 0,
    )
    if (!hasPotionActive) {
      const potionSlot = findPotionSlot(bot, itemsData)
      if (potionSlot >= 0) {
        intents.push({ type: 'drink_potion', inventorySlot: potionSlot })
      }
    }
  }

  // 2. Eat — survival check.
  //    Eat when current hp could die to the opponent's next swing(s).
  //    Eating blocks our own swing this tick, so do it before planning offence.
  if ((bot.eatCooldown || 0) <= 0) {
    const opMaxHit    = estimateBotMaxHit(opponent, bot, itemsData)
    const opponentSwingsNextTick = (opponent.attackTimer || 0) <= 1
    const eatThreshold = opMaxHit + (opponentSwingsNextTick ? opMaxHit : 0) + 5
    if (bot.hp <= eatThreshold) {
      const foodSlot = findFoodSlot(bot, itemsData)
      if (foodSlot >= 0) {
        intents.push({ type: 'eat', inventorySlot: foodSlot })
        return intents   // can't act offensively this tick
      }
    }
  }

  // 3. Offensive plan. `plannedWeapon` is what we'll be wielding after this
  //    tick's decisions; prayer + stance (step 4) are matched to it.
  const willSwingThisTick = (bot.attackTimer || 0) <= 1
  const energy  = clampPvpSpecialEnergy(bot.specialAttackEnergy, 0)
  const current = bot.equipment?.weapon?.itemId
  let plannedWeapon = current

  if (willSwingThisTick) {
    const curSpec     = getEquippedPvpSpecialAttack(bot, itemsData)?.specialAttack || null
    const curCost     = curSpec ? Math.max(0, Number(curSpec.energyCost) || 0) : 0
    const curCanSpec  = !!curSpec && energy >= curCost
    const curBurst    = curCanSpec ? estimateWeaponBurst(current, bot, opponent, itemsData) : 0
    const curNormal   = estimateBotMaxHit(bot, opponent, itemsData)
    // Spend capped cheap energy even outside a KO — free value, it regenerates.
    const cappedCheap = curCanSpec && energy >= 100 && curCost <= 25

    // Aggression vs eating: if the opponent can eat this tick, the damage
    // needed to guarantee a kill is hp + their heal. We try the eat-proof
    // target first (spec/swap to out-damage the heal), then fall back to
    // the kill-now target. A weapon swap that can finish wins over leaving
    // a kill to chance, even if a normal swing could kill a non-eating foe.
    const eatHeal     = opponentBestHeal(opponent, itemsData)
    const canEatNow   = eatHeal > 0 && (opponent.eatCooldown || 0) <= 1
    const targets     = canEatNow ? [opponent.hp + eatHeal, opponent.hp] : [opponent.hp]

    // Returns a finisher swap { inventorySlot, weaponId } that reaches a
    // damage target, or null.
    const findFinisher = (target) => {
      for (const weaponId of KO_WEAPONS) {
        if (weaponId === current) continue
        const inv = findInventoryWeapon(bot, weaponId, itemsData)
        if (!inv) continue
        const spec       = itemsData?.[weaponId]?.specialAttack
        const needEnergy = spec ? Math.max(0, Number(spec.energyCost) || 0) : 0
        if (energy < needEnergy) continue
        if (estimateWeaponBurst(weaponId, bot, opponent, itemsData) >= target) {
          return { inventorySlot: inv.inventorySlot, weaponId }
        }
      }
      return null
    }

    let decided = false
    for (const target of targets) {
      if (curNormal >= target) { decided = true; break }   // a normal swing already secures this
      if (curCanSpec && curBurst >= target) { intents.push({ type: 'queue_special' }); decided = true; break }
      const fin = findFinisher(target)
      if (fin) { intents.push({ type: 'equip', inventorySlot: fin.inventorySlot }); plannedWeapon = fin.weaponId; decided = true; break }
      // Can't reach this target — try the next (lower) one.
    }

    if (!decided && cappedCheap) {
      intents.push({ type: 'queue_special' })
      decided = true
    }

    // No KO being pursued — return to the highest-DPS weapon if we drifted off it.
    if (!decided && !PRIMARY_DPS_WEAPONS.includes(current)) {
      for (const weaponId of PRIMARY_DPS_WEAPONS) {
        const inv = findInventoryWeapon(bot, weaponId, itemsData)
        if (inv) {
          intents.push({ type: 'equip', inventorySlot: inv.inventorySlot })
          plannedWeapon = weaponId
          break
        }
      }
    }
  }

  // 4. Prayer + stance — matched to the weapon we'll be wielding next.
  //    Toggling a *different* prayer id switches to it directly (engine
  //    semantics), so this both activates and corrects the prayer.
  const plannedCombatType = getCombatType(
    { ...bot.equipment, weapon: plannedWeapon ? { itemId: plannedWeapon } : null },
    itemsData,
  )
  const desiredPrayer = bestDamagePrayer(plannedCombatType)
  if (bot.activeCombatPrayer !== desiredPrayer) {
    intents.push({ type: 'toggle_prayer', prayerId: desiredPrayer })
  }
  const desiredStance = bestOffensiveStance(plannedCombatType)
  if (bot.stance !== desiredStance) {
    intents.push({ type: 'change_stance', stance: desiredStance })
  }

  return intents
}
