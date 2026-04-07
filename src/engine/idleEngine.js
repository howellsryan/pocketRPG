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
import { getAgilityBankDelayMs, simulateIdleAgility } from './agility.js'

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
 * Returns { xpGained, lootGained, monstersKilled, lootLost, itemsData needed for names }
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
  const monstersKilled = ticksPerCycle < Infinity
    ? Math.floor(totalTicks / ticksPerCycle)
    : 0

  if (monstersKilled <= 0) return { xpGained: {}, lootGained: {}, monstersKilled: 0, lootLost: {} }

  // XP — simplified: assume average damage per kill = monster.hitpoints
  // actual XP = hitpoints dmg dealt (melee xp for primary skill + hp xp)
  const xpSkill = task.stance === 'aggressive' ? 'strength'
    : task.stance === 'defensive' ? 'defence'
    : 'attack'
  const dmgDealt = monster.hitpoints
  const xpGained = {}
  xpGained[xpSkill] = Math.floor(dmgDealt * MELEE_XP_PER_DAMAGE) * monstersKilled
  xpGained.hitpoints = Math.floor(dmgDealt * HP_XP_PER_DAMAGE) * monstersKilled

  // Loot — simulate drops for each kill, fill inventory slots, discard rest
  const newInv = [...inventory]
  const lootGained = {}   // what made it into inventory
  const lootLost = {}     // what was discarded (inv full)

  for (let k = 0; k < monstersKilled; k++) {
    const drops = idleRollDrops(monster)
    for (const drop of drops) {
      const item = itemsData[drop.itemId]
      const stackable = item?.stackable || false

      // Try to add to inventory
      let added = false
      if (stackable) {
        const existingIdx = newInv.findIndex(s => s && s.itemId === drop.itemId)
        if (existingIdx !== -1) {
          newInv[existingIdx] = { ...newInv[existingIdx], quantity: newInv[existingIdx].quantity + drop.quantity }
          added = true
        } else {
          const emptyIdx = newInv.indexOf(null)
          if (emptyIdx !== -1) {
            newInv[emptyIdx] = { itemId: drop.itemId, quantity: drop.quantity }
            added = true
          }
        }
      } else {
        for (let q = 0; q < drop.quantity; q++) {
          const emptyIdx = newInv.indexOf(null)
          if (emptyIdx !== -1) {
            newInv[emptyIdx] = { itemId: drop.itemId, quantity: 1 }
            added = true
          } else {
            lootLost[drop.itemId] = (lootLost[drop.itemId] || 0) + (drop.quantity - q)
            break
          }
        }
        if (!added && newInv.indexOf(null) === -1) {
          lootLost[drop.itemId] = (lootLost[drop.itemId] || 0) + drop.quantity
          continue
        }
      }

      if (added) {
        lootGained[drop.itemId] = (lootGained[drop.itemId] || 0) + drop.quantity
      } else {
        lootLost[drop.itemId] = (lootLost[drop.itemId] || 0) + drop.quantity
      }
    }
  }

  return { xpGained, lootGained, lootLost, monstersKilled, finalInventory: newInv }
}
