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
//           ready). With no KO on, holds whichever weapon it owns lands the
//           most damage per tick against this opponent.
//   4. Prayer + stance — keep them matched to the weapon we'll be wielding.
//
// Why the off-by-one matters: the engine decrements attackTimer AFTER
// intents are applied, so a swing resolves on the tick where the bot
// enters with attackTimer <= 1. KO/spec decisions therefore gate on
// `willSwingThisTick` rather than `attackTimer === 0`, otherwise the bot
// would only ever spec on the opening tick.

import { getEquippedPvpSpecialAttack, clampPvpSpecialEnergy } from './pvpSpecialAttacks.js'
import { rollMeleeAttack, rollRangedAttack, rollMagicAttack } from './combatPrimitives.js'
import { getCombatType, getRangedAmmoRequirementFailure } from './equipment.js'

// Finisher weapons it swaps to for a kill attempt, cheapest / highest-burst
// first. What it returns to afterwards is measured, not listed — see
// bestEverydayWeapon.
const KO_WEAPONS = ['dragon_dagger', 'dragon_battleaxe']

// A swap has to beat the weapon in hand by this much to be worth the tick.
// Without it two near-identical weapons trade places every tick forever.
const WEAPON_SWAP_MARGIN = 1.05

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

// Damage per tick `weaponId` would land, wielded the way the bot would wield it
// (own style, own damage prayer, own offensive stance). Speed matters as much as
// the hit: a godsword that swings every 5 ticks is not an upgrade on a whip.
function estimateWeaponDps(weaponId, bot, opponent, itemsData) {
  const item = itemsData?.[weaponId]
  if (!item) return 0
  const fakeEquip = { ...bot.equipment, weapon: { itemId: weaponId } }
  const combatType = getCombatType(fakeEquip, itemsData)
  // A bow with the wrong ammo (or none) is a blocked swing, not a weapon.
  if (getRangedAmmoRequirementFailure(fakeEquip, itemsData)) return 0
  const fakeBot = {
    ...bot,
    equipment: fakeEquip,
    combatType,
    stance: bestOffensiveStance(combatType),
    activeCombatPrayer: bestDamagePrayer(combatType),
  }
  const snap = combatType === 'ranged' ? rollRangedAttack(fakeBot, opponent, itemsData)
    : combatType === 'magic' ? rollMagicAttack(fakeBot, opponent, itemsData)
    : rollMeleeAttack(fakeBot, opponent, itemsData)
  const maxHit = snap?.maxHit || 0
  if (maxHit <= 0) return 0
  const base = Math.max(1, Number(item.attackSpeed) || 4)
  const speed = combatType === 'ranged' ? Math.max(1, base - 1) : base   // rapid
  return ((snap.accuracy || 0) * (maxHit + 1) / 2) / speed
}

// Every distinct weapon the bot could be holding this tick: the one in hand
// plus anything in the pack.
function weaponChoices(bot, itemsData) {
  const out = []
  const current = bot.equipment?.weapon?.itemId
  if (current && itemsData?.[current]) out.push({ weaponId: current, inventorySlot: -1 })
  const inv = bot.inventory || []
  for (let i = 0; i < inv.length; i++) {
    const slot = inv[i]
    if (!slot?.itemId || itemsData?.[slot.itemId]?.slot !== 'weapon') continue
    if (out.some((c) => c.weaponId === slot.itemId)) continue
    out.push({ weaponId: slot.itemId, inventorySlot: i })
  }
  return out
}

/**
 * The best weapon the bot owns for the fight in front of it, by damage per tick.
 *
 * This is what a bot returns to once a KO push is over. It used to be a
 * hardcoded id, which meant a bot that had swapped to a dagger for a finisher
 * kept the dagger for the rest of the fight — every melee bot ended its fights
 * holding the worst weapon it owned. Returns null when the weapon in hand is
 * already the best one.
 */
export function bestEverydayWeapon(bot, opponent, itemsData) {
  const current = bot.equipment?.weapon?.itemId
  const currentDps = current ? estimateWeaponDps(current, bot, opponent, itemsData) : 0
  let best = null
  let bestDps = currentDps * WEAPON_SWAP_MARGIN
  for (const choice of weaponChoices(bot, itemsData)) {
    if (choice.inventorySlot < 0) continue
    // Two-handed swap with a shield on needs a free slot for the shield; the
    // engine refuses the equip outright when the pack has none, so proposing it
    // would only burn the decision every tick.
    if (itemsData[choice.weaponId]?.twoHanded && bot.equipment?.shield && !(bot.inventory || []).some((s) => !s)) continue
    const dps = estimateWeaponDps(choice.weaponId, bot, opponent, itemsData)
    if (dps > bestDps) { best = choice; bestDps = dps }
  }
  return best
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
  //    Potions are combo items, gated by the shared combo cooldown.
  if ((bot.comboCooldown || 0) <= 0) {
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

    // No KO being pursued — hold the best weapon we own for this fight.
    if (!decided) {
      const swap = bestEverydayWeapon(bot, opponent, itemsData)
      if (swap) {
        intents.push({ type: 'equip', inventorySlot: swap.inventorySlot })
        plannedWeapon = swap.weaponId
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
