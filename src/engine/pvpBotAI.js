// PvP Bot AI — deterministic, pure, no I/O.
//
// computeBotIntents(state, botId, itemsData, profile) returns an array of
// intent objects (same shape processPvpTick expects) the bot should take
// this tick, in priority order.
//
// Decision pipeline (highest priority first):
//   1. Drink potion at fight start if none active
//   2. Eat if survival threshold breached and no eat cooldown
//   3. Kill push — queue spec if it can plausibly kill; swap to battleaxe
//      for a one-shot attempt when opponent is low
//   4. Prayer — activate best damage prayer for current combat type if none
//   5. Default — nothing (normal shortbow attack continues)

import { getEquippedPvpSpecialAttack, clampPvpSpecialEnergy } from './pvpSpecialAttacks.js'
import { rollMeleeAttack, rollRangedAttack } from './combatPrimitives.js'
import { getAttackSpeed } from './equipment.js'

// ── Internal helpers ──────────────────────────────────────────────────────────

function getBotCombatant(state, botId) {
  return state?.combatants?.[String(botId)] || null
}

function getOpponentCombatant(state, botId) {
  const ids = Object.keys(state?.combatants || {})
  const oppId = ids.find((id) => Number(id) !== Number(botId))
  return oppId ? state.combatants[oppId] : null
}

// Estimate max damage the bot can land in its current weapon configuration.
function estimateBotMaxHit(bot, opponent, itemsData) {
  try {
    const snapshot = bot.combatType === 'melee'
      ? rollMeleeAttack(bot, opponent, itemsData)
      : rollRangedAttack(bot, opponent, itemsData)
    return snapshot?.maxHit || 0
  } catch {
    return 0
  }
}

// Find a weapon in the bot's inventory by itemId; returns { slot, item }.
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

// Best prayer for the bot's combat type (no protection prayers in PvP v1).
function bestDamagePrayer(bot) {
  if (bot.combatType === 'ranged') return 'rigour'
  if (bot.combatType === 'magic')  return 'augury'
  return 'piety'
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

  // 2. Prayer — activate best damage prayer if none active.
  if (!bot.activeCombatPrayer) {
    intents.push({ type: 'toggle_prayer', prayerId: bestDamagePrayer(bot) })
  }

  // 3. Eat — survival check.
  //    Eat when hp could die to opponent's next swing.
  //    Use a heal of 22 (manta_ray) as the look-ahead.
  if ((bot.eatCooldown || 0) <= 0) {
    const MANTA_HEAL  = 22
    const opMaxHit    = estimateBotMaxHit(opponent, bot, itemsData)
    // Eat if: current hp minus opponent's likely max hit is less than a safety
    // margin, BUT only if eating doesn't expose us to certain death (i.e. we
    // have enough ticks before opponent swings to survive the eat delay).
    const opponentSwingsNextTick = (opponent.attackTimer || 0) <= 1
    const eatThreshold = opMaxHit + (opponentSwingsNextTick ? opMaxHit : 0) + 5
    if (bot.hp <= eatThreshold) {
      const foodSlot = findFoodSlot(bot, itemsData)
      if (foodSlot >= 0) {
        intents.push({ type: 'eat', inventorySlot: foodSlot })
        // After eating we can't swing this tick — skip further offensive actions.
        return intents
      }
    }
  }

  // 4. Kill push — spec if it can plausibly kill.
  if ((bot.attackTimer || 0) <= 0 && (bot.eatCooldown || 0) <= 0) {
    const equipped = getEquippedPvpSpecialAttack(bot, itemsData)
    const energy   = clampPvpSpecialEnergy(bot.specialAttackEnergy, 0)

    if (equipped?.specialAttack && energy >= equipped.specialAttack.energyCost) {
      // Estimate spec damage (conservative: use 1.5x normal max hit for overpower,
      // 2 hits at 75% for snapshot, 2 hits at 115% for double_hit).
      const baseMax  = estimateBotMaxHit(bot, opponent, itemsData)
      const specType = equipped.specialAttack.type
      let specMaxEstimate = baseMax

      if (specType === 'snapshot')    specMaxEstimate = Math.floor(baseMax * 0.75) * 2
      if (specType === 'double_hit')  specMaxEstimate = Math.floor(baseMax * 1.15) * 2
      if (specType === 'overpower')   specMaxEstimate = Math.floor(baseMax * 1.5)

      // Queue spec if plausible kill OR energy is capped (free value for cheap specs).
      const canKill    = specMaxEstimate >= opponent.hp
      const energyCap  = energy >= 100 && equipped.specialAttack.energyCost <= 25
      if (canKill || energyCap) {
        intents.push({ type: 'queue_special' })
      }
    }

    // 5. Battleaxe swap for one-shot kill attempt.
    //    If opponent is low and the battleaxe's higher max hit could finish
    //    them when the shortbow can't, swap to it for the kill.
    if (intents.length === 0 || (intents.length === 1 && intents[0].type === 'toggle_prayer')) {
      const currentWeapon = bot.equipment?.weapon?.itemId
      if (currentWeapon !== 'dragon_battleaxe') {
        const axeInInv = findInventoryWeapon(bot, 'dragon_battleaxe', itemsData)
        if (axeInInv) {
          // Temporarily simulate the bot wearing the axe to check max hit
          const fakeBot = {
            ...bot,
            equipment: { ...bot.equipment, weapon: { itemId: 'dragon_battleaxe' } },
            combatType: 'melee',
          }
          let axeMax = 0
          try {
            const snap = rollMeleeAttack(fakeBot, opponent, itemsData)
            axeMax = snap?.maxHit || 0
          } catch { /* ignore */ }
          if (axeMax >= opponent.hp) {
            intents.push({ type: 'equip', inventorySlot: axeInInv.inventorySlot })
          }
        }
      } else {
        // Already on battleaxe and kill shot missed — swap back to shortbow.
        const bowInInv = findInventoryWeapon(bot, 'magic_shortbow', itemsData)
        if (bowInInv) {
          intents.push({ type: 'equip', inventorySlot: bowInInv.inventorySlot })
          intents.push({ type: 'change_stance', stance: 'rapid' })
        }
      }
    }
  }

  return intents
}
