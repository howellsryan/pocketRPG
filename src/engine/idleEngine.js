/**
 * Idle Engine — calculates what would have happened while the player was away.
 * Pure functions, no UI imports.
 */

import { getLevelFromXP } from './experience.js'
import {
  effectiveStrength, meleeMaxHit, effectiveAttack, maxAttackRoll,
  maxDefenceRoll, hitChance, getMeleeStyleBonuses
} from './formulas.js'
import { getEquipmentBonuses, getAttackSpeed, getAttackStyle } from './equipment.js'
import { getToolSpeedMultiplier } from './skilling.js'
import { MELEE_XP_PER_DAMAGE, HP_XP_PER_DAMAGE } from '../utils/constants.js'
import { getAgilityBankDelayFromStats, simulateIdleAgility } from './agility.js'

const TICK_MS = 600

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
 * Returns { xpGained, itemsGained, itemsConsumed, actions, skill, actionName }
 * If the action has materials, caps actions to available bank resources and returns
 * itemsConsumed so the caller can deduct them.
 *
 * equipment and stats are optional — used to apply tool speed bonuses.
 * itemsData is required when equipment is provided (for tool lookup).
 */
export function simulateIdleSkilling(task, elapsedMs, bank, equipment = null, stats = {}, itemsData = {}) {
  if (!task || !task.action) return null

  const totalTicks = Math.floor(elapsedMs / TICK_MS)

  // Apply tool speed multiplier (e.g. mithril axe for woodcutting)
  const toolMult = getToolSpeedMultiplier(task.skill, equipment, itemsData, stats)
  const actionTicks = Math.max(1, Math.floor(task.action.ticks * toolMult))

  let actions = Math.floor(totalTicks / actionTicks)
  if (actions <= 0) return null

  const itemsConsumed = {}

  // Cap actions to available materials in bank
  if (task.action.materials) {
    let maxFromMaterials = Infinity
    for (const [itemId, qtyPerAction] of Object.entries(task.action.materials)) {
      const available = (bank && bank[itemId]) ? bank[itemId].quantity : 0
      const possible = Math.floor(available / qtyPerAction)
      if (possible < maxFromMaterials) maxFromMaterials = possible
    }
    if (maxFromMaterials === 0) return null
    actions = Math.min(actions, maxFromMaterials)

    // Record consumed materials
    for (const [itemId, qtyPerAction] of Object.entries(task.action.materials)) {
      itemsConsumed[itemId] = qtyPerAction * actions
    }
  }

  const xpGained = {}
  const itemsGained = {}

  const xpPer = task.action.xp || 0
  if (xpPer > 0 && task.skill) {
    xpGained[task.skill] = xpPer * actions
  }

  if (task.action.product) {
    const qty = (task.action.productQty || 1) * actions
    itemsGained[task.action.product] = (itemsGained[task.action.product] || 0) + qty
  }

  return { xpGained, itemsGained, itemsConsumed, actions, skill: task.skill, actionName: task.action.name }
}

/**
 * Simulate idle gathering.
 * Returns { itemsGained: { itemId: qty }, actions }
 * Materials consumed from bank if present, otherwise unlimited (simplified).
 */
export function simulateIdleGather(task, elapsedMs) {
  if (!task || !task.gatherTask) return null

  const totalTicks = Math.floor(elapsedMs / TICK_MS)
  const actionTicks = task.gatherTask.ticks
  const actions = Math.floor(totalTicks / actionTicks)
  if (actions <= 0) return null

  const itemsGained = {}
  const qty = (task.gatherTask.qty || 1) * actions
  itemsGained[task.gatherTask.product] = (itemsGained[task.gatherTask.product] || 0) + qty

  return { itemsGained, actions, actionName: task.gatherTask.name }
}

/**
 * Compute average player DPS against a monster.
 * Returns { avgDmgPerHit, weaponSpeed, acc } so callers can use per-hit granularity.
 */
function avgHitStats(playerStats, equipment, monster, stance, itemsData) {
  const bonuses = getEquipmentBonuses(equipment, itemsData)
  const weaponStyle = getAttackStyle(equipment, itemsData)
  const weaponSpeed = getAttackSpeed(equipment, itemsData)
  const styleBonuses = getMeleeStyleBonuses(stance)

  const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
  const maxHit = meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength)
  const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
  const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
  const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus?.[weaponStyle] || 0)
  const acc = hitChance(atkRoll, defRoll)

  // Average damage per hit = acc * maxHit / 2
  const avgDmgPerHit = acc * (maxHit / 2)
  return { avgDmgPerHit, weaponSpeed, acc }
}

/**
 * Roll drops for one monster kill.
 * Returns array of { itemId, quantity }
 */
function idleRollDrops(monster) {
  const drops = []
  for (const drop of (monster.drops || [])) {
    if (Math.random() < drop.chance) {
      const qty = Array.isArray(drop.quantity)
        ? Math.floor(Math.random() * (drop.quantity[1] - drop.quantity[0] + 1)) + drop.quantity[0]
        : drop.quantity
      drops.push({ itemId: drop.itemId, quantity: qty })
    }
  }
  return drops
}

/**
 * Simulate idle combat.
 * Returns { xpGained, lootGained, lootLost, lootBanked, monstersKilled, finalInventory }
 *
 * lootGained  — newly gained items only (difference from starting inventory)
 * lootLost    — items discarded due to full inventory (bankingEnabled = false)
 * lootBanked  — items banked during auto-bank trips (bankingEnabled = true)
 *
 * When task.bankingEnabled is true, the simulation deducts one agility-scaled bank
 * delay per full-inventory trip instead of losing items to the floor.
 *
 * inventory: current inventory array (28 slots)
 * itemsData: items lookup
 */
export function simulateIdleCombat(task, elapsedMs, stats, equipment, inventory, itemsData) {
  if (!task || !task.monster) return null

  const monster = task.monster
  const totalTicks = Math.floor(elapsedMs / TICK_MS)
  if (totalTicks <= 0) return null

  const playerStats = {
    attack:   getLevelFromXP(stats.attack?.xp   || 0),
    strength: getLevelFromXP(stats.strength?.xp || 0),
    defence:  getLevelFromXP(stats.defence?.xp  || 0),
  }

  const { avgDmgPerHit, weaponSpeed } = avgHitStats(playerStats, equipment, monster, task.stance || 'accurate', itemsData)

  // Active engine: playerAttackTimer starts at 0, first hit lands on tick 1,
  // then resets to weaponSpeed. So hits land on ticks: 1, 1+W, 1+2W, ...
  // Hits needed to kill = ceil(hp / avgDmgPerHit)
  // Ticks to kill = 1 + (hitsNeeded - 1) * weaponSpeed
  // After kill: 1200ms respawn = 2 ticks, then playerAttackTimer resets to 0 (continueFight)
  // so next kill also starts with first hit on tick 1.
  const hitsNeeded = avgDmgPerHit > 0 ? Math.ceil(monster.hitpoints / avgDmgPerHit) : Infinity
  const ticksPerKill = hitsNeeded < Infinity
    ? 1 + (hitsNeeded - 1) * weaponSpeed
    : Infinity

  // 2 tick respawn gap between kills (1200ms / 600ms per tick)
  const RESPAWN_TICKS = 2
  const ticksPerCycle = ticksPerKill < Infinity ? ticksPerKill + RESPAWN_TICKS : Infinity

  if (ticksPerCycle === Infinity) {
    return { xpGained: {}, lootGained: {}, monstersKilled: 0, lootLost: {}, lootBanked: {} }
  }

  // Auto-bank setup
  const bankingEnabled = task.bankingEnabled || false
  const bankDelayTicks = Math.ceil(getAgilityBankDelayFromStats(stats) / TICK_MS)

  // XP per kill (assumes player deals exactly monster.hitpoints damage per kill)
  const xpSkill = task.stance === 'aggressive' ? 'strength'
    : task.stance === 'defensive' ? 'defence'
    : 'attack'
  const xpPerKill = {
    [xpSkill]: Math.floor(monster.hitpoints * MELEE_XP_PER_DAMAGE),
    hitpoints:  Math.floor(monster.hitpoints * HP_XP_PER_DAMAGE),
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
  const xpGained   = {}
  let monstersKilled = 0
  let remainingTicks = totalTicks

  while (remainingTicks >= ticksPerCycle) {
    remainingTicks -= ticksPerCycle
    monstersKilled++

    // XP for this kill
    for (const [skill, xp] of Object.entries(xpPerKill)) {
      xpGained[skill] = (xpGained[skill] || 0) + xp
    }

    // Loot for this kill — place items into inventory, overflow to lost/banked
    for (const drop of idleRollDrops(monster)) {
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
    if (bankingEnabled && newInv.indexOf(null) === -1) {
      if (remainingTicks < bankDelayTicks) break
      remainingTicks -= bankDelayTicks
      for (let i = 0; i < newInv.length; i++) {
        if (!newInv[i]) continue
        lootBanked[newInv[i].itemId] = (lootBanked[newInv[i].itemId] || 0) + newInv[i].quantity
        newInv[i] = null
      }
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

  return { xpGained, lootGained, lootLost, lootBanked, monstersKilled, finalInventory: newInv }
}
