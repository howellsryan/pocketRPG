/**
 * Idle Engine — calculates what would have happened while the player was away.
 * Pure functions, no UI imports.
 */

import { getLevelFromXP } from './experience.js'
import {
  effectiveStrength, wornMeleeMaxHit, effectiveAttack, maxAttackRoll,
  maxDefenceRoll, hitChance, getMeleeStyleBonuses,
  effectiveRanged, wornRangedMaxHit, getRangedStyleBonus,
  effectiveMagic, monsterMagicDefenceRoll, magicMaxHit
} from './formulas.js'
import { poweredStaffMagicBaseDamage } from './combatPrimitives.js'
import { getEquipmentBonuses, getAttackSpeed, getMeleeAttackStyle, getCombatType, getRangedAmmoRequirementFailure, getEffectiveWornMagicDamage, getSpellRuneMagicDamage, chargedScaleArmourSlots } from './equipment.js'
import { getEffectiveToolActionTicks, getEquippedSkillXpMultiplier, rollGatherBonusDrops, usesShardglassGatherTool, resolveShardglassToolSource, consumeShardglassGatherCharge, SHARDGLASS_GATHER_TOOLS } from './skilling.js'
import { hasRequiredRunes, getRunesToConsume } from './runes.js'
import { getHighAlchValue } from '../utils/itemValue.js'
import { MELEE_XP_PER_DAMAGE, RANGED_XP_PER_DAMAGE, MAGIC_XP_PER_DAMAGE, HP_XP_PER_DAMAGE, GATHERING_SKILLS, IDLE_AUTOBANK_GATHERING_SKILLS, GATHER_AUTOBANK_CONSTRUCTION_LEVEL } from '../utils/constants.js'
import { addItem, canFit } from './inventory.js'
import { getAgilityBankDelayFromStats, simulateIdleAgility } from './agility.js'
import { rollClueRewards } from './clueScrolls.js'

// Re-exported so callers treat idleEngine as the single idle-sim facade
// (App.jsx and gameState.jsx import simulateIdleAgility from here). The
// single-file build concatenates scopes so this only matters to real bundlers.
export { simulateIdleAgility }
import { resolveSlayerTaskKill, doesSlayerTaskMatchMonster } from './slayerTasks.js'
import { calculateDungeoneeringTokensForAction } from './dungeoneeringTokens.js'
import { getMonsterSeedDrops } from './seedDrops.js'
import { monsterDamageMultiplier } from './monsterDamageRules.js'
import { getDamageReductionPerk, expectedDamageMultiplier, getPrayerDrainMultiplier } from './damageReduction.js'
import { getMonsterCharmDrops } from './summoning.js'
import { getSlayerTaskEquipmentBonuses } from './slayerCombatBonuses.js'
import { getCombatSetMultipliers } from './combatSetBonuses.js'
import {
  isFoodItem, getFoodHealAmount, isBoostPotion, isPrayerRestorePotion,
  getPrayerRestoreAmount, getBoostPotionDurationTicks,
  getValidIdlePrayerSelection, buildAvailableSupplyMap, buildBoostedPlayerStats,
} from './idleSupplies.js'

const TICK_MS = 600
const HP_REGEN_INTERVAL_MS = 60000 // 60 seconds per 1 HP

/** True when the player's Construction level unlocks gather auto-banking. */
function hasGatherAutoBankUnlock(stats) {
  return getLevelFromXP(stats?.construction?.xp || 0) >= GATHER_AUTOBANK_CONSTRUCTION_LEVEL
}

/**
 * Move every inventory slot into the banked totals and clear the inventory,
 * skipping excludedItemIds. A banked slot's `charges` are accumulated into
 * `chargesBanked` so the caller can pool them onto the bank entry — dropping
 * them here would destroy the charges of anything carried on a bank trip.
 */
function bankEverything(inv, itemsBanked, excludedItemIds, chargesBanked) {
  for (let i = 0; i < inv.length; i++) {
    if (!inv[i]) continue
    if (excludedItemIds && excludedItemIds.has(inv[i].itemId)) continue
    itemsBanked[inv[i].itemId] = (itemsBanked[inv[i].itemId] || 0) + inv[i].quantity
    const charges = Math.max(0, Math.floor(Number(inv[i].charges) || 0))
    if (charges > 0 && chargesBanked) {
      chargesBanked[inv[i].itemId] = (chargesBanked[inv[i].itemId] || 0) + charges
    }
    inv[i] = null
  }
}

/** True if a bank trip would actually free a slot (i.e. not every occupied slot is excluded). */
function hasBankableItems(inv, excludedItemIds) {
  if (!excludedItemIds || excludedItemIds.size === 0) return inv.some(Boolean)
  return inv.some(slot => slot && !excludedItemIds.has(slot.itemId))
}

/**
 * Calculate HP regenerated during idle time.
 * Returns { hpRegen } where hpRegen is the number of HP points restored.
 */
export function simulateIdleHPRegen(elapsedMs) {
  const hpRegen = Math.floor(elapsedMs / HP_REGEN_INTERVAL_MS)
  return { hpRegen }
}

/**
 * Roll drops from a drop table (used for mining gems, etc.)
 * Returns object of { itemId: quantity }
 */
function rollDropTableOnce(dropTable) {
  const drops = {}
  for (const drop of dropTable) {
    if (Math.random() < drop.chance) {
      const qty = Array.isArray(drop.quantity)
        ? Math.floor(Math.random() * (drop.quantity[1] - drop.quantity[0] + 1)) + drop.quantity[0]
        : drop.quantity
      drops[drop.itemId] = (drops[drop.itemId] || 0) + qty
    }
  }
  return drops
}

/**
 * Format elapsed milliseconds into a human-readable duration string.
 * Only shows units that have a non-zero value, starting from the largest.
 */
export function formatIdleTime(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const days    = Math.floor(totalSeconds / 86400)
  const hours   = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const parts = []
  if (days > 0)    parts.push(`${days}d`)
  if (hours > 0)   parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`)
  return parts.join(' ')
}

/**
 * Simulate idle skilling.
 * Returns { xpGained, itemsGained, itemsConsumed, itemsDropped, actions, skill, actionName }
 * If the action has materials, caps actions to available bank resources and returns
 * itemsConsumed so the caller can deduct them.
 *
 * When bankingEnabled is true, processes items through inventory with auto-banking.
 * When bankingEnabled is false, items accumulate directly to bank (original behavior).
 *
 * equipment and stats are optional — used to apply tool speed bonuses.
 * itemsData is required when equipment is provided (for tool lookup).
 * inventory is required when bankingEnabled is true (for inventory processing).
 */
export function simulateIdleSkilling(task, elapsedMs, bank, equipment = null, stats = {}, itemsData = {}, inventory = [], options = {}) {
  if (!task || !task.action) return null
  const isIronman = !!options.isIronman
  const excludedItemIds = options.autoBankExcludedItemIds || null

  const totalTicks = Math.floor(elapsedMs / TICK_MS)

  // Long-form reward actions (e.g. Dungeoneering equipment unlocks) progress
  // partially, like quests. They have a single action of many thousands of
  // ticks and should not require a full action to complete in one elapsed
  // window. The task carries its own ticksRemaining; we decrement it by the
  // elapsed tick count and only grant the product on completion.
  if (task.action.category === 'reward') {
    if (task.skill === 'dungeoneering') return null
    const fullTicks = Math.max(1, Math.floor(Number(task.action.ticks) || 1))
    const prevRemaining = Math.max(0, Math.floor(Number(task.ticksRemaining ?? fullTicks)))
    if (prevRemaining <= 0) return null

    const consumed = Math.min(prevRemaining, totalTicks)
    if (consumed <= 0) return null

    const newRemaining = prevRemaining - consumed
    const completed = newRemaining <= 0
    const product = task.action.product
    const rewardItems = task.action.rewardItems || []
    const completedItems = completed
      ? Object.fromEntries([
          ...(product ? [[product, 1]] : []),
          ...rewardItems.map(id => [id, 1])
        ])
      : {}

    return {
      xpGained: {},
      itemsGained: completedItems,
      itemsBanked: completedItems,
      itemsConsumed: {},
      itemsDropped: {},
      actions: completed ? 1 : 0,
      skill: task.skill,
      actionName: task.action.name,
      finalInventory: inventory,
      coinsGained: 0,
      ticksRemaining: completed ? 0 : newRemaining,
      ticksUsed: consumed,
      rewardCompleted: completed,
      rewardTimeReduced: !completed,
    }
  }


  // Apply the same effective tool timing as active skilling.
  const actionTicks = getEffectiveToolActionTicks(task.skill, task.action.ticks, equipment, itemsData, stats, inventory, task.action)

  let actions = Math.floor(totalTicks / actionTicks)
  if (actions <= 0) return null

  const itemsConsumed = {}
  let outOfMaterials = false

  // Cap actions to available materials across inventory + bank
  if (task.action.materials) {
    let maxFromMaterials = Infinity
    for (const [itemId, qtyPerAction] of Object.entries(task.action.materials)) {
      const invCount = inventory.reduce((sum, slot) => sum + (slot?.itemId === itemId ? (slot?.quantity || 0) : 0), 0)
      const bankCount = (bank && bank[itemId]) ? bank[itemId].quantity : 0
      const possible = Math.floor((invCount + bankCount) / qtyPerAction)
      if (possible < maxFromMaterials) maxFromMaterials = possible
    }
    if (maxFromMaterials === 0) return null
    if (maxFromMaterials < actions) outOfMaterials = true
    actions = Math.min(actions, maxFromMaterials)

  }

  // Cap actions to available runes (for magic skilling)
  if (task.action.runeReq) {
    let maxFromRunes = Infinity
    const runesToConsume = getRunesToConsume(task.action.runeReq, equipment, itemsData)

    for (const [runeId, qtyPerAction] of Object.entries(runesToConsume)) {
      const invCount = inventory.reduce((sum, slot) => sum + (slot?.itemId === runeId ? (slot?.quantity || 0) : 0), 0)
      const bankCount = (bank && bank[runeId]) ? bank[runeId].quantity : 0
      const possible = Math.floor((invCount + bankCount) / qtyPerAction)
      if (possible < maxFromRunes) maxFromRunes = possible
    }
    if (maxFromRunes === 0 && Object.keys(runesToConsume).length > 0) return null
    if (maxFromRunes < actions) outOfMaterials = true
    actions = Math.min(actions, maxFromRunes)

  }

  // Cap alchemy actions to available selected item in inventory
  if (task.action.type === 'alchemy' && task.selectedAlchemyItem?.itemId) {
    const availableAlchItems = inventory.reduce(
      (sum, slot) => sum + (
        slot?.itemId === task.selectedAlchemyItem.itemId &&
        !!slot?.noted === !!task.selectedAlchemyItem.noted
          ? (slot?.quantity || 0)
          : 0
      ),
      0
    )
    if (availableAlchItems <= 0) return null
    actions = Math.min(actions, availableAlchItems)
  }

  // Record consumed materials/runes using final action count after all caps
  if (task.action.materials) {
    for (const [itemId, qtyPerAction] of Object.entries(task.action.materials)) {
      itemsConsumed[itemId] = qtyPerAction * actions
    }
  }
  if (task.action.runeReq) {
    const runesToConsume = getRunesToConsume(task.action.runeReq, equipment, itemsData)
    for (const [runeId, qtyPerAction] of Object.entries(runesToConsume)) {
      itemsConsumed[runeId] = qtyPerAction * actions
    }
  }

  const xpGained = {}
  const itemsGained = {}
  const itemsBanked = {}
  const chargesBanked = {}
  const itemsDropped = {}
  const newInv = [...inventory]
  // Charges drained from an *equipped* shardglass gather tool this window —
  // reported back so the caller can persist it onto equipment (mirrors
  // combat's chargesConsumed). An inventory-held tool's charges are written
  // directly onto its finalInventory slot instead, needing no separate field.
  let shardglassChargesConsumed = 0

  const xpMultiplier = getEquippedSkillXpMultiplier(task.skill, equipment, itemsData)
  const xpPer = Math.floor((task.action.xp || 0) * xpMultiplier)
  if (xpPer > 0 && task.skill) {
    xpGained[task.skill] = xpPer * actions
  }

  // Consume runes from inventory (for magic skilling)
  if (task.action.runeReq) {
    const runesToConsume = getRunesToConsume(task.action.runeReq, equipment, itemsData)
    for (const [runeId, qtyPerAction] of Object.entries(runesToConsume)) {
      let remaining = qtyPerAction * actions
      for (let i = 0; i < newInv.length && remaining > 0; i++) {
        if (newInv[i]?.itemId === runeId) {
          const consumed = Math.min(newInv[i].quantity, remaining)
          newInv[i] = { ...newInv[i], quantity: newInv[i].quantity - consumed }
          if (newInv[i].quantity === 0) newInv[i] = null
          remaining -= consumed
        }
      }
      if (remaining > 0) {
        itemsConsumed[runeId] = remaining
      } else {
        delete itemsConsumed[runeId]
      }
    }
  }

  // Consume materials from inventory first, then bank
  if (task.action.materials) {
    for (const [itemId, qtyPerAction] of Object.entries(task.action.materials)) {
      let remaining = qtyPerAction * actions
      for (let i = 0; i < newInv.length && remaining > 0; i++) {
        if (newInv[i]?.itemId === itemId) {
          const consumed = Math.min(newInv[i].quantity, remaining)
          newInv[i] = { ...newInv[i], quantity: newInv[i].quantity - consumed }
          if (newInv[i].quantity === 0) newInv[i] = null
          remaining -= consumed
        }
      }
      if (remaining > 0) {
        itemsConsumed[itemId] = remaining
      } else {
        delete itemsConsumed[itemId]
      }
    }
  }

  // The initial `actions` estimate above is capped by elapsed time and raw
  // material/rune availability, and materials/XP were charged for that many
  // actions right away. A banking-enabled production loop below can still
  // complete fewer actions than that estimate whenever a non-stackable
  // product (bars, ores, etc.) forces repeated bank trips that eat into the
  // elapsed-time budget. `refundUnusedActions` below undoes the charge for
  // whatever shortfall shows up, so materials/XP always match what was
  // actually produced instead of silently vanishing.
  const refundUnusedActions = (actionsCompleted) => {
    const shortfall = actions - actionsCompleted
    if (shortfall <= 0) return
    if (xpPer > 0 && task.skill) {
      const refundedXp = xpPer * shortfall
      xpGained[task.skill] = Math.max(0, (xpGained[task.skill] || 0) - refundedXp)
      if (xpGained[task.skill] <= 0) delete xpGained[task.skill]
    }
    const refundQty = (itemId, qtyPerAction) => {
      let refund = qtyPerAction * shortfall
      const bankPortion = Math.min(refund, itemsConsumed[itemId] || 0)
      if (bankPortion > 0) {
        itemsConsumed[itemId] -= bankPortion
        if (itemsConsumed[itemId] <= 0) delete itemsConsumed[itemId]
        refund -= bankPortion
      }
      if (refund > 0) addItem(newInv, itemId, refund, itemsData[itemId]?.stackable || false)
    }
    if (task.action.materials) {
      for (const [itemId, qtyPerAction] of Object.entries(task.action.materials)) refundQty(itemId, qtyPerAction)
    }
    if (task.action.runeReq) {
      const runesToConsume = getRunesToConsume(task.action.runeReq, equipment, itemsData)
      for (const [runeId, qtyPerAction] of Object.entries(runesToConsume)) refundQty(runeId, qtyPerAction)
    }
  }

  // Handle alchemy (converts items to coins)
  let coinsGained = 0
  if (task.action.type === 'alchemy' && task.selectedAlchemyItem) {
    const alchItem = itemsData[task.selectedAlchemyItem.itemId]
    if (alchItem && typeof alchItem.shopValue === 'number') {
      const coinsPerAction = getHighAlchValue(alchItem, { isIronman })
      coinsGained = coinsPerAction * actions

      // Consume the alchemized items from inventory
      let remaining = actions
      for (let i = 0; i < newInv.length && remaining > 0; i++) {
        if (
          newInv[i]?.itemId === task.selectedAlchemyItem.itemId &&
          !!newInv[i]?.noted === !!task.selectedAlchemyItem.noted
        ) {
          const consumed = Math.min(newInv[i].quantity, remaining)
          newInv[i] = { ...newInv[i], quantity: newInv[i].quantity - consumed }
          if (newInv[i].quantity === 0) newInv[i] = null
          remaining -= consumed
        }
      }
    }
  }

  // Gathering skills (mining/woodcutting/fishing) deposit into the inventory and
  // stop when it fills. With the Construction unlock, a full inventory triggers
  // an agility-scaled bank trip so gathering keeps going.
  // Real-time active play (the App-level background runner) passes autoBank:false
  // so a full inventory pauses the action and reports inventory_full for the
  // global prompt instead of silently auto-banking. Offline catch-up / skip-hour
  // leave it unset (auto-bank as before).
  const autoBankEnabled = options.autoBank !== false
  const isGatheringSkill = GATHERING_SKILLS.includes(task.skill)
  let gatheringStoppedReason

  if (isGatheringSkill && (task.action.dropTable || task.action.product)) {
    // Mining/woodcutting/fishing always auto-bank during idle/skip so the
    // inventory cap can't stall the session; other gatherers (farming) still
    // require the Construction auto-bank unlock.
    const bankWhenFull = autoBankEnabled && (hasGatherAutoBankUnlock(stats) || IDLE_AUTOBANK_GATHERING_SKILLS.includes(task.skill))
    const bankDelayTicks = Math.ceil(getAgilityBankDelayFromStats(stats) / TICK_MS)
    const productQty = task.action.productQty || 1

    // Shardglass tool identity is fixed for the session (locked like actionTicks);
    // its charge total is snapshotted here too and drained action-by-action below.
    const shardglassGather = usesShardglassGatherTool(task.skill, equipment, inventory, itemsData, stats)
    const shardglassToolId = SHARDGLASS_GATHER_TOOLS[task.skill]
    const shardglassSource = shardglassGather ? resolveShardglassToolSource(task.skill, equipment, newInv) : null
    const shardglassEquipped = !!shardglassSource?.equipped
    const shardglassStartCharges = shardglassSource?.charges || 0
    let shardglassCharges = shardglassStartCharges

    const startingInvState = {}
    for (const slot of newInv) {
      if (!slot) continue
      startingInvState[slot.itemId] = (startingInvState[slot.itemId] || 0) + slot.quantity
    }

    let remainingTicks = totalTicks
    let actionsCompleted = 0
    let inventoryFull = false

    while (remainingTicks >= actionTicks && actionsCompleted < actions) {
      const drops = task.action.dropTable
        ? rollDropTableOnce(task.action.dropTable)
        : { [task.action.product]: productQty }
      if (shardglassGather) shardglassCharges = consumeShardglassGatherCharge(drops, shardglassCharges)
      const bonus = rollGatherBonusDrops(task.skill)
      for (const [itemId, qty] of Object.entries(bonus)) {
        drops[itemId] = (drops[itemId] || 0) + qty
      }

      if (!canFit(newInv, drops, itemsData)) {
        if (bankWhenFull && hasBankableItems(newInv, excludedItemIds)) {
          if (remainingTicks < bankDelayTicks + actionTicks) break
          remainingTicks -= bankDelayTicks
          bankEverything(newInv, itemsBanked, excludedItemIds, chargesBanked)
        } else {
          inventoryFull = true
          break
        }
      }
      remainingTicks -= actionTicks
      actionsCompleted++
      for (const [itemId, qty] of Object.entries(drops)) {
        if (qty > 0) addItem(newInv, itemId, qty, itemsData[itemId]?.stackable || false)
      }
    }

    if (shardglassGather) {
      if (shardglassEquipped) {
        shardglassChargesConsumed = Math.max(0, shardglassStartCharges - shardglassCharges)
      } else {
        const toolIdx = newInv.findIndex(s => s && s.itemId === shardglassToolId)
        if (toolIdx !== -1) newInv[toolIdx] = { ...newInv[toolIdx], charges: shardglassCharges }
      }
    }

    const totalAccumulated = { ...itemsBanked }
    for (const slot of newInv) {
      if (!slot) continue
      totalAccumulated[slot.itemId] = (totalAccumulated[slot.itemId] || 0) + slot.quantity
    }
    for (const [itemId, qty] of Object.entries(totalAccumulated)) {
      const netGain = qty - (startingInvState[itemId] || 0)
      if (netGain > 0) itemsGained[itemId] = netGain
    }

    // XP is only earned for actions actually completed before the inventory filled.
    refundUnusedActions(actionsCompleted)
    actions = actionsCompleted
    if (inventoryFull) gatheringStoppedReason = 'inventory_full'
  }
  // Handle drop table (for actions with multiple possible products like gem mining)
  else if (task.action.dropTable) {
    const bankingEnabled = (task.bankingEnabled || false) && autoBankEnabled

    // Track starting inventory state
    const startingInvState = {}
    for (const slot of newInv) {
      if (!slot) continue
      startingInvState[slot.itemId] = (startingInvState[slot.itemId] || 0) + slot.quantity
    }

    if (bankingEnabled) {
      const bankDelayTicks = Math.ceil(getAgilityBankDelayFromStats(stats) / TICK_MS)
      let remainingTicks = totalTicks
      let actionsCompleted = 0

      while (remainingTicks >= actionTicks && actionsCompleted < actions) {
        remainingTicks -= actionTicks
        actionsCompleted++

        // Roll drops and add to inventory
        const drops = rollDropTableOnce(task.action.dropTable)
        for (const [itemId, qty] of Object.entries(drops)) {
          const item = itemsData[itemId]
          const stackable = item?.stackable || false

          if (stackable) {
            const existingIdx = newInv.findIndex(s => s && s.itemId === itemId)
            if (existingIdx !== -1) {
              newInv[existingIdx] = { ...newInv[existingIdx], quantity: newInv[existingIdx].quantity + qty }
            } else {
              const emptyIdx = newInv.indexOf(null)
              if (emptyIdx !== -1) {
                newInv[emptyIdx] = { itemId, quantity: qty }
              } else {
                itemsDropped[itemId] = (itemsDropped[itemId] || 0) + qty
              }
            }
          } else {
            for (let q = 0; q < qty; q++) {
              const emptyIdx = newInv.indexOf(null)
              if (emptyIdx !== -1) {
                newInv[emptyIdx] = { itemId, quantity: 1 }
              } else {
                itemsDropped[itemId] = (itemsDropped[itemId] || 0) + 1
              }
            }
          }
        }

        // Auto-bank trip if inventory full
        if (newInv.indexOf(null) === -1 && hasBankableItems(newInv, excludedItemIds)) {
          if (remainingTicks < bankDelayTicks) break
          remainingTicks -= bankDelayTicks
          bankEverything(newInv, itemsBanked, excludedItemIds, chargesBanked)
        }
      }

      // Compute itemsGained
      const totalAccumulated = { ...itemsBanked }
      for (const slot of newInv) {
        if (!slot) continue
        totalAccumulated[slot.itemId] = (totalAccumulated[slot.itemId] || 0) + slot.quantity
      }
      for (const [itemId, qty] of Object.entries(totalAccumulated)) {
        const netGain = qty - (startingInvState[itemId] || 0)
        if (netGain > 0) itemsGained[itemId] = netGain
      }
      // Bank trips (forced by a full inventory) cost time, so fewer actions may
      // have completed than the time/material estimate that XP/materials were
      // already charged against above — refund the shortfall.
      refundUnusedActions(actionsCompleted)
      actions = actionsCompleted
    } else {
      // Banking disabled: items fill inventory, excess is dropped
      for (let a = 0; a < actions; a++) {
        const drops = rollDropTableOnce(task.action.dropTable)
        for (const [itemId, qty] of Object.entries(drops)) {
          const item = itemsData[itemId]
          const stackable = item?.stackable || false

          if (stackable) {
            const existingIdx = newInv.findIndex(s => s && s.itemId === itemId)
            if (existingIdx !== -1) {
              newInv[existingIdx] = { ...newInv[existingIdx], quantity: newInv[existingIdx].quantity + qty }
              itemsGained[itemId] = (itemsGained[itemId] || 0) + qty
            } else {
              const emptyIdx = newInv.indexOf(null)
              if (emptyIdx !== -1) {
                newInv[emptyIdx] = { itemId, quantity: qty }
                itemsGained[itemId] = (itemsGained[itemId] || 0) + qty
              } else {
                itemsDropped[itemId] = (itemsDropped[itemId] || 0) + qty
              }
            }
          } else {
            for (let q = 0; q < qty; q++) {
              const emptyIdx = newInv.indexOf(null)
              if (emptyIdx !== -1) {
                newInv[emptyIdx] = { itemId, quantity: 1 }
                itemsGained[itemId] = (itemsGained[itemId] || 0) + 1
              } else {
                itemsDropped[itemId] = (itemsDropped[itemId] || 0) + 1
              }
            }
          }
        }
      }
    }
  }
  // Handle product placement based on bankingEnabled
  else if (task.action.product) {
    const bankingEnabled = (task.bankingEnabled || false) && autoBankEnabled
    const product = task.action.product
    const qtyPerAction = task.action.productQty || 1

    // Track starting inventory state
    const startingInvState = {}
    for (const slot of newInv) {
      if (!slot) continue
      startingInvState[slot.itemId] = (startingInvState[slot.itemId] || 0) + slot.quantity
    }

    if (bankingEnabled) {
      // Process items through inventory with auto-banking on full
      const bankDelayTicks = Math.ceil(getAgilityBankDelayFromStats(stats) / TICK_MS)
      let remainingTicks = totalTicks
      let actionsCompleted = 0

      while (remainingTicks >= actionTicks && actionsCompleted < actions) {
        remainingTicks -= actionTicks
        actionsCompleted++

        // Add product to inventory
        const item = itemsData[product]
        const stackable = item?.stackable || false

        if (stackable) {
          const existingIdx = newInv.findIndex(s => s && s.itemId === product)
          if (existingIdx !== -1) {
            newInv[existingIdx] = { ...newInv[existingIdx], quantity: newInv[existingIdx].quantity + qtyPerAction }
          } else {
            const emptyIdx = newInv.indexOf(null)
            if (emptyIdx !== -1) {
              newInv[emptyIdx] = { itemId: product, quantity: qtyPerAction }
            } else {
              itemsDropped[product] = (itemsDropped[product] || 0) + qtyPerAction
            }
          }
        } else {
          // Non-stackable
          for (let q = 0; q < qtyPerAction; q++) {
            const emptyIdx = newInv.indexOf(null)
            if (emptyIdx !== -1) {
              newInv[emptyIdx] = { itemId: product, quantity: 1 }
            } else {
              itemsDropped[product] = (itemsDropped[product] || 0) + 1
            }
          }
        }

        // Auto-bank trip if inventory full — bank EVERYTHING (like a real trip)
        if (newInv.indexOf(null) === -1 && hasBankableItems(newInv, excludedItemIds)) {
          if (remainingTicks < bankDelayTicks) break
          remainingTicks -= bankDelayTicks
          bankEverything(newInv, itemsBanked, excludedItemIds, chargesBanked)
        }
      }

      // Compute itemsGained = net new items = (all banked + final inventory) - starting inventory
      const totalAccumulated = { ...itemsBanked }
      for (const slot of newInv) {
        if (!slot) continue
        totalAccumulated[slot.itemId] = (totalAccumulated[slot.itemId] || 0) + slot.quantity
      }
      for (const [itemId, qty] of Object.entries(totalAccumulated)) {
        const netGain = qty - (startingInvState[itemId] || 0)
        if (netGain > 0) itemsGained[itemId] = netGain
      }
      // Bank trips (forced by a full inventory, e.g. a non-stackable product like
      // bars) cost time, so fewer actions may have completed than the time/material
      // estimate that XP/materials were already charged against above — refund
      // the shortfall so materials never get consumed for output that was never
      // actually produced.
      refundUnusedActions(actionsCompleted)
      actions = actionsCompleted
    } else {
      // Banking disabled: produce into the inventory until it fills, then stop —
      // matching live skilling (you can't smith with a full inventory). The
      // product is NEVER dropped: a material-consuming skill dropping its output
      // while still charging the ingredients silently drained the bank (e.g.
      // smithing 28 bars but consuming ore for hundreds of un-kept ones). Refund
      // the unused actions so materials/XP track what was actually produced.
      const item = itemsData[product]
      const stackable = item?.stackable || false
      let actionsCompleted = 0
      let inventoryFull = false

      for (let a = 0; a < actions; a++) {
        let added = false
        if (stackable) {
          const existingIdx = newInv.findIndex(s => s && s.itemId === product)
          if (existingIdx !== -1) {
            newInv[existingIdx] = { ...newInv[existingIdx], quantity: newInv[existingIdx].quantity + qtyPerAction }
            added = true
          } else {
            const emptyIdx = newInv.indexOf(null)
            if (emptyIdx !== -1) {
              newInv[emptyIdx] = { itemId: product, quantity: qtyPerAction }
              added = true
            }
          }
        } else {
          // Non-stackable needs `qtyPerAction` free slots or the action can't complete.
          const freeCount = newInv.reduce((n, s) => n + (s ? 0 : 1), 0)
          if (freeCount >= qtyPerAction) {
            for (let q = 0; q < qtyPerAction; q++) {
              newInv[newInv.indexOf(null)] = { itemId: product, quantity: 1 }
            }
            added = true
          }
        }
        if (!added) { inventoryFull = true; break }
        actionsCompleted++
      }

      // Compute gains before the refund so refunded materials don't count as product.
      for (const slot of newInv) {
        if (!slot) continue
        const startingQty = startingInvState[slot.itemId] || 0
        const deltaQty = slot.quantity - startingQty
        if (deltaQty > 0) {
          itemsGained[slot.itemId] = (itemsGained[slot.itemId] || 0) + deltaQty
        }
      }

      refundUnusedActions(actionsCompleted)
      actions = actionsCompleted
      if (inventoryFull) gatheringStoppedReason = 'inventory_full'
    }
  }

  const dungeoneeringTokensGained = task.skill === 'dungeoneering' && task.action?.category !== 'reward'
    ? calculateDungeoneeringTokensForAction(task.action) * actions
    : 0

  const stoppedReason = gatheringStoppedReason
    ? gatheringStoppedReason
    : (outOfMaterials ? 'out_of_materials' : undefined)

  return { xpGained, itemsGained, itemsBanked, chargesBanked, itemsConsumed, itemsDropped, actions, skill: task.skill, actionName: task.action.name, finalInventory: newInv, coinsGained, dungeoneeringTokensGained, stoppedReason, chargesConsumed: shardglassChargesConsumed }
}

/**
 * Simulate idle gathering.
 * Returns { itemsGained: { itemId: qty }, itemsDropped, actions }
 * Always processes items through inventory with auto-banking enabled.
 * When inventory fills, triggers bank trip with agility-scaled delay.
 *
 * inventory: current inventory array (28 slots)
 * stats: player stats for agility-based bank delay
 * itemsData: items lookup for stackable/non-stackable determination
 */
export function simulateIdleGather(task, elapsedMs, inventory = [], stats = {}, itemsData = {}, bank = {}, options = {}) {
  if (!task || !task.gatherTask) return null
  const excludedItemIds = options.autoBankExcludedItemIds || null
  if (task.gatherTask.requiresItem && !task.gatherTask.isClue) {
    const requiredItem = task.gatherTask.requiresItem
    const invCount = inventory.reduce((sum, slot) => sum + (slot?.itemId === requiredItem ? (slot.quantity || 1) : 0), 0)
    const bankCount = bank?.[requiredItem]?.quantity || 0
    if (invCount + bankCount <= 0) return null
  }

  const totalTicks = Math.floor(elapsedMs / TICK_MS)
  const actionTicks = task.gatherTask.ticks
  let actions = Math.floor(totalTicks / actionTicks)
  if (actions <= 0) return null

  // OneShot minigame tasks (e.g. void set) complete once and bank all reward
  // items directly, matching the active-path behaviour in GatherScreen.
  if (task.gatherTask.oneShot) {
    const allRewards = task.gatherTask.rewardItems?.length > 0
      ? task.gatherTask.rewardItems
      : (task.gatherTask.product ? [task.gatherTask.product] : [])
    const itemsBanked = Object.fromEntries(allRewards.map(id => [id, 1]))
    return {
      itemsGained: { ...itemsBanked },
      itemsBanked,
      itemsDropped: {},
      itemsConsumed: {},
      actions: 1,
      actionName: task.gatherTask.name,
      finalInventory: inventory,
    }
  }

  // Clue scroll tasks roll a reward table per completion and consume one
  // scroll from the bank. Rewards go directly to the bank; inventory is
  // untouched (matches the live tick handler in GatherScreen).
  if (task.gatherTask.isClue) {
    const requiredItem = task.gatherTask.requiresItem
    const clueLevel = task.gatherTask.clueLevel
    const available = bank?.[requiredItem]?.quantity || 0
    const completable = Math.min(actions, available)
    if (completable <= 0) {
      return null
    }

    const itemsBanked = {}
    for (let i = 0; i < completable; i++) {
      const rewards = rollClueRewards(clueLevel)
      for (const r of rewards) {
        itemsBanked[r.itemId] = (itemsBanked[r.itemId] || 0) + r.quantity
      }
    }

    return {
      itemsGained: { ...itemsBanked },
      itemsBanked,
      itemsConsumed: { [requiredItem]: completable },
      actions: completable,
      actionName: task.gatherTask.name,
    }
  }

  const itemsConsumed = {}
  let outOfMaterials = false

  // Cap actions to available materials across inventory (noted + un-noted) and bank
  if (task.gatherTask.materials) {
    let maxFromMaterials = Infinity
    for (const [itemId, qtyPerAction] of Object.entries(task.gatherTask.materials)) {
      const invCount = inventory.reduce((sum, slot) => sum + (slot?.itemId === itemId ? (slot?.quantity || 0) : 0), 0)
      const bankCount = (bank && bank[itemId]) ? bank[itemId].quantity : 0
      const possible = Math.floor((invCount + bankCount) / qtyPerAction)
      if (possible < maxFromMaterials) maxFromMaterials = possible
    }
    if (maxFromMaterials === 0) return null
    if (maxFromMaterials < actions) outOfMaterials = true
    actions = Math.min(actions, maxFromMaterials)
  }

  // Cap actions by available coins for gpCost tasks
  if (task.gatherTask.gpCost) {
    const invCoins = inventory.reduce((sum, slot) => sum + (slot?.itemId === 'coins' ? (slot?.quantity || 0) : 0), 0)
    const bankCoins = (bank && bank['coins']) ? bank['coins'].quantity : 0
    const maxFromCoins = Math.floor((invCoins + bankCoins) / task.gatherTask.gpCost)
    if (maxFromCoins === 0) return null
    if (maxFromCoins < actions) outOfMaterials = true
    actions = Math.min(actions, maxFromCoins)
  }

  // Gathered items land in the inventory by default. Once full, the action
  // stops — unless the player has the Construction unlock, which turns a full
  // inventory into an agility-scaled bank trip so gathering can continue.
  const bankWhenFull = hasGatherAutoBankUnlock(stats) && options.autoBank !== false
  const bankDelayTicks = Math.ceil(getAgilityBankDelayFromStats(stats) / TICK_MS)

  const itemsGained = {}
  const itemsBanked = {}
  const chargesBanked = {}
  const itemsDropped = {}
  const newInv = [...inventory]
  let remainingTicks = totalTicks
  const product = task.gatherTask.product
  const qtyPerAction = task.gatherTask.qty || 1
  const stackable = itemsData[product]?.stackable || false

  // Track starting inventory state for delta calculation
  const startingInvState = {}
  for (const slot of inventory) {
    if (!slot) continue
    startingInvState[slot.itemId] = (startingInvState[slot.itemId] || 0) + slot.quantity
  }

  let actionsCompleted = 0
  let inventoryFull = false

  while (remainingTicks >= actionTicks && actionsCompleted < actions) {
    if (!canFit(newInv, { [product]: qtyPerAction }, itemsData)) {
      if (bankWhenFull && hasBankableItems(newInv, excludedItemIds)) {
        // Bank trip: need time for the trip plus the next action.
        if (remainingTicks < bankDelayTicks + actionTicks) break
        remainingTicks -= bankDelayTicks
        bankEverything(newInv, itemsBanked, excludedItemIds, chargesBanked)
      } else {
        inventoryFull = true
        break
      }
    }
    remainingTicks -= actionTicks
    actionsCompleted++
    addItem(newInv, product, qtyPerAction, stackable)
  }

  // Consume materials per completed action — inventory first (un-noted before noted), then bank.
  if (task.gatherTask.materials && actionsCompleted > 0) {
    for (const [itemId, qtyPerAction] of Object.entries(task.gatherTask.materials)) {
      let remaining = qtyPerAction * actionsCompleted
      // Un-noted inventory first
      for (let i = 0; i < newInv.length && remaining > 0; i++) {
        const slot = newInv[i]
        if (!slot || slot.itemId !== itemId || slot.noted) continue
        const take = Math.min(slot.quantity, remaining)
        newInv[i] = { ...slot, quantity: slot.quantity - take }
        if (newInv[i].quantity === 0) newInv[i] = null
        remaining -= take
      }
      // Noted inventory second
      for (let i = 0; i < newInv.length && remaining > 0; i++) {
        const slot = newInv[i]
        if (!slot || slot.itemId !== itemId || !slot.noted) continue
        const take = Math.min(slot.quantity, remaining)
        newInv[i] = { ...slot, quantity: slot.quantity - take }
        if (newInv[i].quantity === 0) newInv[i] = null
        remaining -= take
      }
      // Remainder comes from bank
      if (remaining > 0) itemsConsumed[itemId] = remaining
    }
  }

  // Deduct GP cost — inventory coins first, then bank
  if (task.gatherTask.gpCost && actionsCompleted > 0) {
    let remaining = task.gatherTask.gpCost * actionsCompleted
    for (let i = 0; i < newInv.length && remaining > 0; i++) {
      const slot = newInv[i]
      if (!slot || slot.itemId !== 'coins') continue
      const take = Math.min(slot.quantity, remaining)
      newInv[i] = { ...slot, quantity: slot.quantity - take }
      if (newInv[i].quantity === 0) newInv[i] = null
      remaining -= take
    }
    if (remaining > 0) itemsConsumed['coins'] = (itemsConsumed['coins'] || 0) + remaining
  }

  // Compute itemsGained = net new items = (all banked + final inventory) - starting inventory
  const totalAccumulated = { ...itemsBanked }
  for (const slot of newInv) {
    if (!slot) continue
    totalAccumulated[slot.itemId] = (totalAccumulated[slot.itemId] || 0) + slot.quantity
  }
  for (const [itemId, qty] of Object.entries(totalAccumulated)) {
    const netGain = qty - (startingInvState[itemId] || 0)
    if (netGain > 0) itemsGained[itemId] = netGain
  }

  const stoppedReason = inventoryFull
    ? 'inventory_full'
    : (outOfMaterials ? 'out_of_materials' : undefined)

  return { itemsGained, itemsBanked, chargesBanked, itemsDropped, itemsConsumed, actions: actionsCompleted, actionName: task.gatherTask.name, finalInventory: newInv, stoppedReason }
}

/**
 * Resolve the monster's effective attack style for incoming-damage estimation.
 * Multi-style monsters use a deterministic fallback (first listed) so the
 * idle simulator stays deterministic.
 */
function resolveMonsterAttackStyle(monster) {
  if (!monster) return 'crush'
  if (monster.attackStyles && Array.isArray(monster.attackStyles) && monster.attackStyles.length > 0) {
    const first = monster.attackStyles[0]
    if (first === 'melee') return 'crush'
    return first
  }
  return monster.attackStyle || 'crush'
}

/**
 * Estimate the average incoming damage per monster attack against the player,
 * mirroring active-combat formulas so idle and live behave consistently.
 * Returns { avgDmg, monsterAtkSpeed, attackStyle }.
 */
export function estimateMonsterIncomingPerAttack(monster, equipment, itemsData, playerStats, stance) {
  const monsterAtkSpeed = Math.max(1, Math.floor(monster?.attackSpeed || 4))
  const attackStyle = resolveMonsterAttackStyle(monster)
  if (!monster) return { avgDmg: 0, monsterAtkSpeed, attackStyle }

  const bonuses = getEquipmentBonuses(equipment, itemsData)
  const monsterEffAtk = ((monster.stats?.magic || monster.stats?.attack || 1) + 9)
  const monsterAtkRoll = monsterEffAtk * ((monster.attackBonus || 0) + 64)
  const styleBonuses = getMeleeStyleBonuses(stance)
  const playerDefLevel = Math.max(1, Math.floor(Number(playerStats?.defence) || 1))
  const effDef = playerDefLevel + styleBonuses.defenceStyleBonus + 8
  const defBonus = bonuses.defenceBonus[attackStyle]
  const defBonusValue = (defBonus !== undefined ? defBonus : (bonuses.defenceBonus.crush || 0))
  const defRoll = effDef * (defBonusValue + 64)
  const acc = hitChance(monsterAtkRoll, defRoll)
  const baseStrength = Math.max(1, Math.floor(Number(monster.stats?.strength) || 1))
  const monsterMaxHit = monster.formMaxHit != null
    ? monster.formMaxHit
    : Math.floor(0.5 + (baseStrength + 8) * ((monster.strengthBonus || 0) + 64) / 640)
  // Worn damage-reduction perk (Aegis Wraithbone Shield) — the idle sim models
  // averages, so the proc applies as its expected multiplier.
  const reductionMultiplier = expectedDamageMultiplier(getDamageReductionPerk(bonuses))
  const avgDmg = Math.max(0, acc * (monsterMaxHit / 2) * reductionMultiplier)
  return { avgDmg, monsterAtkSpeed, attackStyle, acc }
}

/**
 * Returns true when a protection prayer style fully covers a monster attack
 * style. Mirrors the live-combat helper.
 */
function protectionPrayerCovers(prayerStyle, attackStyle) {
  if (!prayerStyle || !attackStyle) return false
  if (prayerStyle === 'melee') return ['crush', 'stab', 'slash'].includes(attackStyle)
  return prayerStyle === attackStyle
}

/**
 * Compute average player DPS against a monster.
 * Returns { avgDmgPerHit, weaponSpeed, acc, combatType } so callers can use per-hit granularity.
 */
function avgHitStats(playerStats, equipment, monster, stance, itemsData, spell = null, slayerTask = null) {
  const bonuses = getEquipmentBonuses(equipment, itemsData)
  const slayerEquipmentBonus = getSlayerTaskEquipmentBonuses({ equipment, itemsData, slayerTask, monsterId: monster.id })
  const weaponSpeed = getAttackSpeed(equipment, itemsData)
  const voidMult = getCombatSetMultipliers(equipment)
  const weaponEntry = equipment?.weapon
  const weaponItem = weaponEntry ? itemsData[weaponEntry.itemId] : null
  const isPoweredStaff = !!weaponItem?.poweredStaff
  let combatType = getCombatType(equipment, itemsData)
  // A magic weapon with no castable spell (and no built-in powered-staff
  // attack) can't cast — fight with melee until a spell is selected, instead
  // of dealing 0 damage forever.
  if (combatType === 'magic' && !spell && !isPoweredStaff) combatType = 'melee'

  let maxHit, atkRoll, defRoll, acc

  if (combatType === 'ranged') {
    const styleBonus = getRangedStyleBonus(stance)
    const effRng = effectiveRanged(playerStats.ranged, 0, 1.0, styleBonus)
    maxHit = Math.floor(wornRangedMaxHit(effRng, bonuses.otherBonus) * voidMult.rangedDamage)
    atkRoll = Math.floor(maxAttackRoll(effRng, bonuses.attackBonus.ranged || 0) * voidMult.rangedAccuracy)
    defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus?.ranged || 0)
  } else if (combatType === 'magic') {
    const effMag = effectiveMagic(playerStats.magic || 1)
    const baseDamage = spell
      ? spell.baseDamage
      : poweredStaffMagicBaseDamage(playerStats.magic || 1, equipment?.weapon ? itemsData[equipment.weapon.itemId] : null)
    const wornMagicDamage = getEffectiveWornMagicDamage(bonuses.otherBonus.magicDamage, equipment, itemsData)
    maxHit = magicMaxHit(baseDamage, wornMagicDamage + voidMult.magicDamageBonusFlat + getSpellRuneMagicDamage(equipment, itemsData, spell))
    atkRoll = Math.floor(maxAttackRoll(effMag, bonuses.attackBonus.magic || 0) * voidMult.magicAccuracy)
    defRoll = monsterMagicDefenceRoll(monster.stats.magic || 1, monster.stats.defence, monster.defenceBonus?.magic || 0)
  } else {
    // Melee (default)
    const weaponStyle = getMeleeAttackStyle(equipment, itemsData)
    const styleBonuses = getMeleeStyleBonuses(stance)
    const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
    maxHit = Math.floor(wornMeleeMaxHit(effStr, bonuses.otherBonus) * voidMult.meleeDamage)
    const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
    atkRoll = Math.floor(maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0) * voidMult.meleeAccuracy)
    defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus?.[weaponStyle] || 0)
  }

  acc = hitChance(atkRoll, defRoll)
  // Monster damage resistance (spear-gated bosses) — mirrors live combat so a
  // resisted boss can't be killed twice as fast by idling it.
  const resistance = monsterDamageMultiplier(monster, weaponItem)
  const avgDmgPerHit = acc * (maxHit / 2) * resistance
  return { avgDmgPerHit, weaponSpeed, acc, combatType, resistance }
}

/**
 * Roll drops for one monster kill.
 * Returns array of { itemId, quantity }
 */
function idleRollDrops(monster, isOnTask = false) {
  const drops = []
  for (const drop of (monster.drops || [])) {
    // Task-only drops (e.g. Imbued Crown/Brain) never roll off-task.
    if (drop.taskOnly && !isOnTask) continue
    if (Math.random() < drop.chance) {
      const qty = Array.isArray(drop.quantity)
        ? Math.floor(Math.random() * (drop.quantity[1] - drop.quantity[0] + 1)) + drop.quantity[0]
        : drop.quantity
      drops.push({ itemId: drop.itemId, quantity: qty })
    }
  }
  // Seeds / saplings — universal bonus drop scaled by combat level.
  for (const drop of getMonsterSeedDrops(monster)) {
    if (Math.random() < drop.chance) drops.push({ itemId: drop.itemId, quantity: drop.quantity })
  }
  // Summoning charms — universal, combat-level tiered.
  for (const drop of getMonsterCharmDrops(monster)) {
    if (Math.random() < drop.chance) drops.push({ itemId: drop.itemId, quantity: drop.quantity })
  }
  return drops
}

/**
 * Simulate idle combat.
 * Returns { xpGained, lootGained, lootLost, lootBanked, monstersKilled, finalInventory, slayerXpGained, slayerTaskUpdate }
 *
 * lootGained  — newly gained items only (difference from starting inventory)
 * lootLost    — items discarded due to full inventory (bankingEnabled = false)
 * lootBanked  — items banked during auto-bank trips (bankingEnabled = true)
 * slayerXpGained — slayer XP earned from monsters on-task
 * slayerTaskUpdate — updated slayer task with new monstersRemaining, or null if task complete
 *
 * When task.bankingEnabled is true, the simulation deducts one agility-scaled bank
 * delay per full-inventory trip instead of losing items to the floor.
 *
 * inventory: current inventory array (28 slots)
 * itemsData: items lookup
 * slayerTask: optional current slayer task (if not on-task, will be null)
 */
export function simulateIdleCombat(task, elapsedMs, stats, equipment, inventory, itemsData, slayerTask = null, bank = {}, options = {}) {
  if (!task || !task.monster) return null
  const excludedItemIds = options.autoBankExcludedItemIds || null

  const monster = task.monster
  // Block boss and raid fights; allow normal monsters to idle
  if (monster.boss === true || task.raid === true) return null
  const totalTicks = Math.floor(elapsedMs / TICK_MS)
  if (totalTicks <= 0) return null

  // Normalise legacy 'controlled' stance — no longer offered in the UI.
  const rawStance = task.stance || 'accurate'
  const stance = rawStance === 'controlled' ? 'accurate' : rawStance

  const playerStats = {
    attack:   getLevelFromXP(stats.attack?.xp   || 0),
    strength: getLevelFromXP(stats.strength?.xp || 0),
    defence:  getLevelFromXP(stats.defence?.xp  || 0),
    ranged:   getLevelFromXP(stats.ranged?.xp   || 0),
    magic:    getLevelFromXP(stats.magic?.xp    || 0),
  }

  const RESPAWN_TICKS = 2
  const prayersData = options.prayersData || null

  // ── Idle-supply pre-processing ────────────────────────────────────────────
  // Configured-vs-available is computed up front against the snapshot of
  // inventory + bank passed in. The simulation never grants bonuses from
  // missing supplies and only deducts what was actually consumed.
  const idleFood = Array.isArray(options.idleFood) ? options.idleFood : []
  const idlePotions = Array.isArray(options.idlePotions) ? options.idlePotions : []
  const idlePrayersRaw = options.idlePrayers || {}
  const prayerLevel = Math.max(1, Math.floor(Number(getLevelFromXP(stats.prayer?.xp || 0)) || 1))
  const idlePrayers = prayersData
    ? getValidIdlePrayerSelection(idlePrayersRaw, prayersData, prayerLevel)
    : { protectionPrayerId: null, combatPrayerId: null }

  const foodAvailableMap = buildAvailableSupplyMap(idleFood, inventory, bank)
  const potionsAvailableMap = buildAvailableSupplyMap(idlePotions, inventory, bank)

  // Build ordered queues for food + potions so consumption follows the
  // player's configured priority. Boost potions and prayer-restore potions
  // are split because they participate in different supply pools.
  const foodQueue = []
  for (const entry of idleFood) {
    const avail = foodAvailableMap[entry.itemId]?.available || 0
    if (avail <= 0) continue
    const item = itemsData?.[entry.itemId]
    const heal = getFoodHealAmount(item)
    if (heal <= 0) continue
    foodQueue.push({ itemId: entry.itemId, heal, remaining: avail })
  }

  const boostQueue = []
  const restoreQueue = []
  for (const entry of idlePotions) {
    const avail = potionsAvailableMap[entry.itemId]?.available || 0
    if (avail <= 0) continue
    const item = itemsData?.[entry.itemId]
    if (!item) continue
    if (isBoostPotion(item)) {
      boostQueue.push({
        itemId: entry.itemId,
        item,
        durationTicks: getBoostPotionDurationTicks(item),
        // Unlimited-use items (e.g. Imbued Brain) are never depleted or
        // deducted from real inventory — one owned copy re-triggers forever.
        remaining: item.unlimited ? Infinity : avail,
        unlimited: !!item.unlimited,
      })
    } else if (isPrayerRestorePotion(item)) {
      restoreQueue.push({
        itemId: entry.itemId,
        item,
        restoreAmount: getPrayerRestoreAmount(item),
        remaining: avail,
      })
    }
  }

  const foodConsumed = {}
  const potionsConsumed = {}

  function consumeFood(maxNeeded = 1) {
    if (maxNeeded <= 0) return null
    while (foodQueue.length > 0 && foodQueue[0].remaining <= 0) foodQueue.shift()
    const head = foodQueue[0]
    if (!head) return null
    head.remaining--
    foodConsumed[head.itemId] = (foodConsumed[head.itemId] || 0) + 1
    if (head.remaining <= 0) foodQueue.shift()
    return head.heal
  }

  function consumeRestorePotion() {
    while (restoreQueue.length > 0 && restoreQueue[0].remaining <= 0) restoreQueue.shift()
    const head = restoreQueue[0]
    if (!head) return 0
    head.remaining--
    potionsConsumed[head.itemId] = (potionsConsumed[head.itemId] || 0) + 1
    if (head.remaining <= 0) restoreQueue.shift()
    return head.restoreAmount
  }

  function consumeBoostPotionAtIndex(index) {
    const entry = boostQueue[index]
    if (!entry || entry.remaining <= 0) return null
    if (entry.unlimited) return entry
    entry.remaining--
    potionsConsumed[entry.itemId] = (potionsConsumed[entry.itemId] || 0) + 1
    return entry
  }

  // ── Per-state combat metrics ─────────────────────────────────────────────
  // We re-evaluate kill metrics whenever the boost/prayer state flips so the
  // simulator never applies bonuses that have already expired.
  function getKillMetricsFor(boostItem, useCombatPrayer) {
    const layered = buildBoostedPlayerStats(
      playerStats,
      boostItem,
      useCombatPrayer ? idlePrayers.combatPrayerId : null,
      prayersData,
    )
    const hitStats = avgHitStats(layered, equipment, monster, stance, itemsData, task.spell || null, slayerTask)
    const incoming = estimateMonsterIncomingPerAttack(monster, equipment, itemsData, layered, stance)
    if (!Number.isFinite(hitStats.avgDmgPerHit) || hitStats.avgDmgPerHit <= 0) {
      return { ...hitStats, hitsNeeded: Infinity, ticksPerKill: Infinity, ticksPerCycle: Infinity, incoming }
    }
    const hitsNeeded = Math.ceil(monster.hitpoints / hitStats.avgDmgPerHit)
    const ticksPerKill = 1 + (hitsNeeded - 1) * hitStats.weaponSpeed
    return { ...hitStats, hitsNeeded, ticksPerKill, ticksPerCycle: ticksPerKill + RESPAWN_TICKS, incoming }
  }

  // Baseline metrics (used for the resource caps + early outs).
  const baseMetrics = getKillMetricsFor(null, false)
  const { avgDmgPerHit, weaponSpeed, combatType } = baseMetrics
  const hitsNeeded = baseMetrics.hitsNeeded
  const ticksPerKill = baseMetrics.ticksPerKill
  const ticksPerCycle = baseMetrics.ticksPerCycle

  const rangedAmmoFailure = combatType === 'ranged' ? getRangedAmmoRequirementFailure(equipment, itemsData) : null
  if (rangedAmmoFailure) {
    return { xpGained: {}, lootGained: {}, monstersKilled: 0, lootLost: {}, lootBanked: {} }
  }

  if (ticksPerCycle === Infinity) {
    return { xpGained: {}, lootGained: {}, monstersKilled: 0, lootLost: {}, lootBanked: {} }
  }

  // Auto-bank setup
  const bankingEnabled = task.bankingEnabled || false
  const bankDelayTicks = Math.ceil(getAgilityBankDelayFromStats(stats) / TICK_MS)
  const weaponEntry = equipment?.weapon
  const weaponItem = weaponEntry ? itemsData[weaponEntry.itemId] : null

  // XP per kill (assumes player deals exactly monster.hitpoints damage per kill)
  let xpPerKill = {}
  if (combatType === 'ranged') {
    if (stance === 'longrange') {
      // Longrange splits ranged and defence XP
      xpPerKill.ranged = Math.floor(monster.hitpoints * (RANGED_XP_PER_DAMAGE / 2))
      xpPerKill.defence = Math.floor(monster.hitpoints * (RANGED_XP_PER_DAMAGE / 2))
    } else {
      xpPerKill.ranged = Math.floor(monster.hitpoints * RANGED_XP_PER_DAMAGE)
    }
  } else if (combatType === 'magic') {
    const isPoweredStaff = !!weaponItem?.poweredStaff
    if (task.spell || isPoweredStaff) {
      // Spellcasting: base spell XP per cast + damage XP.
      // Powered staves: no spell selected, only damage XP (same as active combat).
      const baseSpellXp = task.spell
        ? (hitsNeeded < Infinity ? hitsNeeded : 0) * (task.spell.baseXP || 0)
        : 0
      xpPerKill.magic = Math.floor(baseSpellXp + monster.hitpoints * MAGIC_XP_PER_DAMAGE)
    }
  } else {
    // Melee
    const xpSkill = stance === 'aggressive' ? 'strength'
      : stance === 'defensive' ? 'defence'
      : 'attack'
    xpPerKill[xpSkill] = Math.floor(monster.hitpoints * MELEE_XP_PER_DAMAGE)
  }
  xpPerKill.hitpoints = Math.floor(monster.hitpoints * HP_XP_PER_DAMAGE)

  // Pre-calculate resource-limited kill caps
  const attacksPerKill = hitsNeeded < Infinity ? hitsNeeded : 0

  let maxKillsFromAmmo = Infinity
  if (combatType === 'ranged' && weaponItem?.ammoType) {
    const ammoQty = Math.max(0, Number(equipment?.ammo?.quantity) || 0)
    maxKillsFromAmmo = attacksPerKill > 0 ? Math.floor(ammoQty / attacksPerKill) : 0
  }

  let maxKillsFromRunes = Infinity
  if (combatType === 'magic' && task.spell?.runeReq && hitsNeeded < Infinity) {
    const runesToConsume = getRunesToConsume(task.spell.runeReq, equipment, itemsData)
    for (const [runeId, qtyPerCast] of Object.entries(runesToConsume)) {
      const invCount = inventory.reduce((sum, slot) => sum + (slot?.itemId === runeId ? (slot?.quantity || 0) : 0), 0)
      const bankCount = (bank && bank[runeId]) ? bank[runeId].quantity : 0
      const runesPerKill = qtyPerCast * hitsNeeded
      if (runesPerKill > 0) {
        maxKillsFromRunes = Math.min(maxKillsFromRunes, Math.floor((invCount + bankCount) / runesPerKill))
      }
    }
  }

  // Scale-charged weapons consume one charge per attack. Cap kills to what the
  // currently loaded charges allow — charges cannot be refilled mid-idle.
  const weaponScaleCharged = !!weaponItem?.scaleCharged
  const startingCharges = weaponEntry?.charges || 0
  // Scale-charged armour (shardglass) burns one charge per worn piece per hit
  // taken. Idle is approximate: bonuses aren't recomputed mid-window, so we
  // just tally expected landed hits and drain each piece by that (capped).
  const armourChargeSlots = chargedScaleArmourSlots(equipment, itemsData)
  const armourStartCharges = {}
  for (const slot of armourChargeSlots) armourStartCharges[slot] = equipment[slot]?.charges || 0
  let armourHitsTaken = 0
  let maxKillsFromCharges = Infinity
  if (weaponScaleCharged && hitsNeeded < Infinity) {
    // Scale-charged weapons (ranged, powered-staff magic, scythe melee) consume
    // one scale per swing — cap idle kills to what loaded charges allow.
    maxKillsFromCharges = Math.floor(startingCharges / hitsNeeded)
  }

  // Track starting inventory state for delta calculation
  const startingInvState = {}
  for (const slot of inventory) {
    if (!slot) continue
    startingInvState[slot.itemId] = (startingInvState[slot.itemId] || 0) + slot.quantity
  }

  // Simulate kill-by-kill, tracking remaining time so bank trips can deduct time
  const newInv = [...inventory]
  const lootLost   = {}
  const lootBanked = {}
  const chargesBanked = {}
  const xpGained   = {}
  let monstersKilled = 0
  let monstersKilledOnTask = 0
  let slayerXpGained = 0
  let remainingTicks = totalTicks

  const maxKillsFromResources = Math.min(maxKillsFromAmmo, maxKillsFromRunes, maxKillsFromCharges)

  // ── Supply state ─────────────────────────────────────────────────────────
  const maxHP = stats.hitpoints ? getLevelFromXP(stats.hitpoints.xp || 0) : 10
  const startingHP = Number.isFinite(Number(options.currentHP)) ? Math.max(0, Math.floor(Number(options.currentHP))) : maxHP
  let hp = Math.min(maxHP, startingHP)

  // Prayer pool: starts at the player's current Prayer level only when an
  // idle prayer is active; otherwise no drain or restore-potion consumption.
  const idlePrayerActiveInitially = !!(idlePrayers.protectionPrayerId || idlePrayers.combatPrayerId)
  // Worn drain-reduction perk (Vigil Wraithbone Shield) stretches the pool.
  const prayerDrainMultiplier = getPrayerDrainMultiplier(getEquipmentBonuses(equipment, itemsData))
  const prayerPointsStarted = idlePrayerActiveInitially ? prayerLevel : 0
  let prayerPool = prayerPointsStarted
  let prayerPointsUsed = 0
  let prayerPointsRestored = 0
  let damageTaken = 0
  let damagePreventedByPrayer = 0
  let stoppedReason = null

  // Active boost potions (one tracked duration per configured boost potion).
  // If multiple boost potions are selected, consume/apply all of them.
  const activeBoostTicksByItemId = {}
  function ensureBoosts() {
    for (let i = 0; i < boostQueue.length; i++) {
      const entry = boostQueue[i]
      if (!entry || entry.remaining <= 0) continue
      const currentTicks = activeBoostTicksByItemId[entry.itemId] || 0
      if (currentTicks > 0) continue
      const consumed = consumeBoostPotionAtIndex(i)
      if (consumed) activeBoostTicksByItemId[entry.itemId] = consumed.durationTicks
    }
  }
  ensureBoosts()

  while (remainingTicks > 0 && monstersKilled < maxKillsFromResources) {
    ensureBoosts()

    const useCombatPrayer = !!idlePrayers.combatPrayerId && prayerPool > 0
    const activeBoostItems = Object.keys(activeBoostTicksByItemId)
      .map(itemId => itemsData?.[itemId])
      .filter(Boolean)
    const layeredBoostStats = activeBoostItems.reduce(
      (acc, potionItem) => buildBoostedPlayerStats(acc, potionItem, null, null),
      { ...playerStats },
    )
    const metrics = (() => {
      const layeredWithPrayer = useCombatPrayer
        ? buildBoostedPlayerStats(layeredBoostStats, null, idlePrayers.combatPrayerId, prayersData)
        : layeredBoostStats
      const hitStats = avgHitStats(layeredWithPrayer, equipment, monster, stance, itemsData, task.spell || null, slayerTask)
      const incoming = estimateMonsterIncomingPerAttack(monster, equipment, itemsData, layeredWithPrayer, stance)
      if (!Number.isFinite(hitStats.avgDmgPerHit) || hitStats.avgDmgPerHit <= 0) {
        return { ...hitStats, hitsNeeded: Infinity, ticksPerKill: Infinity, ticksPerCycle: Infinity, incoming }
      }
      const hitsNeeded = Math.ceil(monster.hitpoints / hitStats.avgDmgPerHit)
      const ticksPerKill = 1 + (hitsNeeded - 1) * hitStats.weaponSpeed
      return { ...hitStats, hitsNeeded, ticksPerKill, ticksPerCycle: ticksPerKill + RESPAWN_TICKS, incoming }
    })()

    if (!Number.isFinite(metrics.ticksPerCycle) || metrics.ticksPerCycle === Infinity) {
      stoppedReason = stoppedReason || 'resource_limited'
      break
    }
    if (remainingTicks < metrics.ticksPerCycle) break

    const playerAttacks = metrics.hitsNeeded
    const monsterAttacks = Math.max(0, Math.floor(metrics.ticksPerKill / metrics.incoming.monsterAtkSpeed))
    const events = playerAttacks + monsterAttacks

    // Lock in whether prayer is active for the entire kill: top up from
    // restore potions if the pool can't cover it. Once prayer is depleted
    // mid-session it stays off (no idle resurrection).
    let protectionActive = false
    let prayerCoverFraction = 0
    const prayerCost = Math.max(0, Math.ceil(events * prayerDrainMultiplier))
    if (idlePrayerActiveInitially && prayerCost > 0) {
      while (prayerPool < prayerCost && restoreQueue.length > 0) {
        const restored = consumeRestorePotion()
        if (restored <= 0) break
        prayerPool += restored
        prayerPointsRestored += restored
      }
      if (prayerPool >= prayerCost) {
        protectionActive = !!idlePrayers.protectionPrayerId
        prayerPool -= prayerCost
        prayerPointsUsed += prayerCost
        prayerCoverFraction = 1
      } else if (prayerPool > 0) {
        // Partial coverage on the way out — protect the first portion of
        // damage proportionally, then prayer goes dark for the remainder of
        // the session.
        prayerCoverFraction = prayerPool / prayerCost
        protectionActive = !!idlePrayers.protectionPrayerId
        prayerPointsUsed += prayerPool
        prayerPool = 0
      }
    }

    // Incoming damage this kill — reduced by protection prayer when active.
    let dmgFromMonster = monsterAttacks * metrics.incoming.avgDmg
    let dmgPrevented = 0
    if (protectionActive && prayersData) {
      const prayer = prayersData[idlePrayers.protectionPrayerId]
      if (prayer && prayer.bonusType === 'protection' && protectionPrayerCovers(prayer.style, metrics.incoming.attackStyle)) {
        const reductionPct = Math.max(0, Math.min(100, Number(prayer.damageReductionPercent) || 0))
        const fullReduction = (dmgFromMonster * reductionPct) / 100
        dmgPrevented = fullReduction * prayerCoverFraction
        dmgFromMonster = Math.max(0, dmgFromMonster - dmgPrevented)
      }
    }
    // Record prevention up front — the prayer pool drained to make it happen,
    // so the player gets credit even if combat aborts this kill from HP loss.
    damagePreventedByPrayer += dmgPrevented

    // Eat reactively when HP would drop low. Idle/skip is now high-risk:
    // if the monster still kills the player after the food queue is
    // exhausted, the simulation records a death and the caller decides
    // whether that triggers a One-Life wipe or a normal respawn.
    hp -= dmgFromMonster
    while (hp <= 1 && foodQueue.length > 0) {
      const heal = consumeFood()
      if (heal == null) break
      hp = Math.min(maxHP, hp + heal)
    }
    if (hp <= 0) {
      // Survivability exhausted — character died mid-kill. The kill that
      // would have completed is not rewarded.
      hp = 0
      stoppedReason = 'died'
      break
    }
    damageTaken += Math.max(0, dmgFromMonster)

    // Expected landed hits this kill (each armour piece burns a charge per hit).
    if (armourChargeSlots.length) {
      armourHitsTaken += monsterAttacks * (Number(metrics.incoming.acc) || 0)
    }

    // Advance time for the kill (player attacks + respawn).
    const killTicks = metrics.ticksPerCycle
    for (const itemId of Object.keys(activeBoostTicksByItemId)) {
      activeBoostTicksByItemId[itemId] -= killTicks
      if (activeBoostTicksByItemId[itemId] <= 0) delete activeBoostTicksByItemId[itemId]
    }

    remainingTicks -= killTicks
    monstersKilled++

    // Is this kill on the player's currently assigned slayer task monster?
    // (independent of the task-completion cap below, so task-only drops like
    // Imbued Crown/Brain are eligible on the kill that finishes the task too.)
    const isOnTask = !!(slayerTask && doesSlayerTaskMatchMonster(slayerTask.monsterId, monster.id))

    // Check if this kill counts toward slayer task — cap at total task count
    if (isOnTask && monstersKilledOnTask < slayerTask.monstersRemaining) {
      monstersKilledOnTask++
      // Auto-slayer chain: stop the instant the task is cleared so the caller
      // knows exactly how much idle time this task consumed and can assign the
      // next one. Without this the loop would keep farming the same monster for
      // the rest of the window (the default, unlock-off behaviour).
      if (options.stopOnSlayerComplete && monstersKilledOnTask >= slayerTask.monstersRemaining) {
        stoppedReason = 'slayer_task_complete'
        break
      }
    }

    // XP for this kill
    for (const [skill, xp] of Object.entries(xpPerKill)) {
      xpGained[skill] = (xpGained[skill] || 0) + xp
    }

    // Loot for this kill — place items into inventory, overflow to lost/banked
    for (const drop of idleRollDrops(monster, isOnTask)) {
      const item = itemsData[drop.itemId]
      const stackable = item?.stackable || false

      if (stackable) {
        const existingIdx = newInv.findIndex(s => s && s.itemId === drop.itemId)
        if (existingIdx !== -1) {
          newInv[existingIdx] = { ...newInv[existingIdx], quantity: newInv[existingIdx].quantity + drop.quantity }
        } else {
          const emptyIdx = newInv.indexOf(null)
          if (emptyIdx !== -1) {
            newInv[emptyIdx] = { itemId: drop.itemId, quantity: drop.quantity }
          } else {
            if (bankingEnabled) lootBanked[drop.itemId] = (lootBanked[drop.itemId] || 0) + drop.quantity
            else                lootLost[drop.itemId]   = (lootLost[drop.itemId]   || 0) + drop.quantity
          }
        }
      } else {
        // Place non-stackable items one-by-one; track exact placed vs lost counts
        let addedQty = 0
        for (let q = 0; q < drop.quantity; q++) {
          const emptyIdx = newInv.indexOf(null)
          if (emptyIdx !== -1) {
            newInv[emptyIdx] = { itemId: drop.itemId, quantity: 1 }
            addedQty++
          } else {
            break
          }
        }
        const lostQty = drop.quantity - addedQty
        if (lostQty > 0) {
          if (bankingEnabled) lootBanked[drop.itemId] = (lootBanked[drop.itemId] || 0) + lostQty
          else                lootLost[drop.itemId]   = (lootLost[drop.itemId]   || 0) + lostQty
        }
      }
    }

    // Auto-bank trip: if inventory is full and banking is enabled, deduct travel
    // time and clear inventory into lootBanked. Stop if no time remains.
    if (bankingEnabled && newInv.indexOf(null) === -1 && hasBankableItems(newInv, excludedItemIds)) {
      if (remainingTicks < bankDelayTicks) break
      remainingTicks -= bankDelayTicks
      bankEverything(newInv, lootBanked, excludedItemIds, chargesBanked)
    }
  }

  // Post-loop top-up: a real player would eat back to full before stepping
  // away. Mirror that here so a skip never hands the player back near death
  // while food remains. Counted into foodConsumed/itemsConsumed automatically.
  // Skipped on death — a corpse doesn't eat.
  if (stoppedReason !== 'died') {
    while (hp < maxHP && foodQueue.length > 0) {
      const heal = consumeFood()
      if (heal == null) break
      hp = Math.min(maxHP, hp + heal)
    }
  }

  // Deduct runes for magic combat: consume from inventory first, track bank overflow
  const runesConsumed = {}
  if (combatType === 'magic' && task.spell?.runeReq && hitsNeeded < Infinity && monstersKilled > 0) {
    const runesToConsume = getRunesToConsume(task.spell.runeReq, equipment, itemsData)
    for (const [runeId, qtyPerCast] of Object.entries(runesToConsume)) {
      let remaining = qtyPerCast * hitsNeeded * monstersKilled
      for (let i = 0; i < newInv.length && remaining > 0; i++) {
        if (newInv[i]?.itemId === runeId) {
          const consumed = Math.min(newInv[i].quantity, remaining)
          newInv[i] = { ...newInv[i], quantity: newInv[i].quantity - consumed }
          if (newInv[i].quantity === 0) newInv[i] = null
          remaining -= consumed
        }
      }
      if (remaining > 0) runesConsumed[runeId] = remaining
    }
  }

  // lootGained is the delta from starting inventory (only newly acquired items)
  const lootGained = {}
  for (const slot of newInv) {
    if (!slot) continue
    const startingQty = startingInvState[slot.itemId] || 0
    const deltaQty = slot.quantity - startingQty
    if (deltaQty > 0) {
      lootGained[slot.itemId] = deltaQty
    }
  }

  // Calculate slayer task update
  let slayerTaskUpdate = null
  if (slayerTask && monster?.id && monstersKilled > 0) {
    const slayerResult = resolveSlayerTaskKill(slayerTask, monster.id, monstersKilled)
    if (slayerResult.onTask) {
      const killsForTask = slayerResult.killsApplied
      const slayerXpMultiplier = options.doubleSlayerXp ? 4 : 2
      slayerXpGained = Math.floor(((monster.slayerXP || monster.hitpoints) * slayerXpMultiplier) * killsForTask)
      slayerTaskUpdate = slayerResult.completed
        ? { completed: true, pointsOnComplete: slayerResult.pointsAwarded, killsApplied: slayerResult.killsApplied }
        : slayerResult.task
      monstersKilledOnTask = killsForTask
    }
  }

  // Track consumed combat resources so callers can mutate equipped state.
  const ammoConsumed = (combatType === 'ranged' && weaponItem?.ammoType && equipment?.ammo?.itemId && attacksPerKill > 0)
    ? { itemId: equipment.ammo.itemId, quantity: Math.min(Math.max(0, Number(equipment?.ammo?.quantity) || 0), attacksPerKill * monstersKilled) }
    : null

  const chargesConsumed = weaponScaleCharged && hitsNeeded < Infinity
    ? Math.min(startingCharges, hitsNeeded * monstersKilled)
    : 0

  const armourChargesConsumed = {}
  if (armourChargeSlots.length) {
    const hits = Math.floor(armourHitsTaken)
    for (const slot of armourChargeSlots) {
      const consumed = Math.min(armourStartCharges[slot] || 0, hits)
      if (consumed > 0) armourChargesConsumed[slot] = consumed
    }
  }

  const resourceLimited = (maxKillsFromResources !== Infinity) && (monstersKilled >= maxKillsFromResources) && (remainingTicks >= ticksPerCycle)
  if (resourceLimited && !stoppedReason) stoppedReason = 'resource_limited'
  if (!stoppedReason) stoppedReason = 'completed_elapsed'

  const ticksUsed = Math.max(0, totalTicks - remainingTicks)
  const effectiveElapsedMs = ticksUsed * TICK_MS

  // Build idleSupplies report: configured-vs-available so the modal can show
  // "used / configured-or-available" in a single glance.
  const supplyReport = {
    foodConfigured: {},
    foodAvailable: {},
    potionsConfigured: {},
    potionsAvailable: {},
  }
  for (const entry of idleFood) {
    if (!entry?.itemId) continue
    supplyReport.foodConfigured[entry.itemId] = (supplyReport.foodConfigured[entry.itemId] || 0) + Math.max(0, Math.floor(Number(entry.quantity) || 0))
    supplyReport.foodAvailable[entry.itemId] = foodAvailableMap[entry.itemId]?.available || 0
  }
  for (const entry of idlePotions) {
    if (!entry?.itemId) continue
    supplyReport.potionsConfigured[entry.itemId] = (supplyReport.potionsConfigured[entry.itemId] || 0) + Math.max(0, Math.floor(Number(entry.quantity) || 0))
    supplyReport.potionsAvailable[entry.itemId] = potionsAvailableMap[entry.itemId]?.available || 0
  }

  // Deduct consumed food + potions from the simulated inventory first; any
  // remainder is reported in itemsConsumed so the caller can also debit the
  // shared bank.
  const supplyConsumedTotals = {}
  for (const [itemId, qty] of Object.entries(foodConsumed)) {
    if (qty > 0) supplyConsumedTotals[itemId] = (supplyConsumedTotals[itemId] || 0) + qty
  }
  for (const [itemId, qty] of Object.entries(potionsConsumed)) {
    if (qty > 0) supplyConsumedTotals[itemId] = (supplyConsumedTotals[itemId] || 0) + qty
  }

  const itemsConsumed = {}
  for (const [itemId, qty] of Object.entries(supplyConsumedTotals)) {
    let remaining = qty
    for (let i = 0; i < newInv.length && remaining > 0; i++) {
      const slot = newInv[i]
      if (!slot || slot.itemId !== itemId || slot.noted) continue
      const take = Math.min(slot.quantity || 0, remaining)
      if (take <= 0) continue
      newInv[i] = { ...slot, quantity: slot.quantity - take }
      if (newInv[i].quantity <= 0) newInv[i] = null
      remaining -= take
    }
    if (remaining > 0) itemsConsumed[itemId] = remaining
  }

  const died = stoppedReason === 'died'
  const finalHP = died ? 0 : Math.max(1, Math.min(maxHP, Math.floor(hp)))

  return {
    xpGained, lootGained, lootLost, lootBanked, chargesBanked, runesConsumed,
    monstersKilled, monstersKilledOnTask, finalInventory: newInv,
    slayerXpGained, slayerTaskUpdate, chargesConsumed, armourChargesConsumed, ammoConsumed,
    attacksUsed: attacksPerKill * monstersKilled, resourceLimited,
    // Idle-supply outputs:
    effectiveElapsedMs,
    stoppedReason,
    died,
    finalHP,
    damageTaken: Math.max(0, Math.floor(damageTaken)),
    damagePreventedByPrayer: Math.max(0, Math.floor(damagePreventedByPrayer)),
    foodConsumed,
    potionsConsumed,
    itemsConsumed,
    prayerPointsStarted,
    prayerPointsRestored,
    prayerPointsUsed,
    prayerPointsRemaining: Math.max(0, Math.floor(prayerPool)),
    idlePrayersUsed: { ...idlePrayers },
    idleSupplies: supplyReport,
  }
}
