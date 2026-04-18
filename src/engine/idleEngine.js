/**
 * Idle Engine — calculates what would have happened while the player was away.
 * Pure functions, no UI imports.
 */

import { getLevelFromXP } from './experience.js'
import {
  effectiveStrength, meleeMaxHit, effectiveAttack, maxAttackRoll,
  maxDefenceRoll, hitChance, getMeleeStyleBonuses,
  effectiveRanged, rangedMaxHit, getRangedStyleBonus,
  effectiveMagic, monsterMagicDefenceRoll, magicMaxHit
} from './formulas.js'
import { getEquipmentBonuses, getAttackSpeed, getAttackStyle, getCombatType } from './equipment.js'
import { getToolSpeedMultiplier } from './skilling.js'
import { hasRequiredRunes, getRunesToConsume } from './runes.js'
import { MELEE_XP_PER_DAMAGE, RANGED_XP_PER_DAMAGE, MAGIC_XP_PER_DAMAGE, HP_XP_PER_DAMAGE } from '../utils/constants.js'
import { getAgilityBankDelayFromStats, simulateIdleAgility } from './agility.js'

const TICK_MS = 600
const HP_REGEN_INTERVAL_MS = 60000 // 60 seconds per 1 HP

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
export function simulateIdleSkilling(task, elapsedMs, bank, equipment = null, stats = {}, itemsData = {}, inventory = []) {
  if (!task || !task.action) return null

  const totalTicks = Math.floor(elapsedMs / TICK_MS)

  // Apply tool speed multiplier (e.g. mithril axe for woodcutting)
  // Use provided inventory to check for tools; prefer equipped tools if available
  const toolMult = getToolSpeedMultiplier(task.skill, equipment, itemsData, stats, inventory)
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
    actions = Math.min(actions, maxFromRunes)

    // Record consumed runes (only those not provided by staff)
    for (const [runeId, qtyPerAction] of Object.entries(runesToConsume)) {
      itemsConsumed[runeId] = qtyPerAction * actions
    }
  }

  const xpGained = {}
  const itemsGained = {}
  const itemsBanked = {}
  const itemsDropped = {}
  const newInv = [...inventory]

  const xpPer = task.action.xp || 0
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
    }
  }

  // Handle drop table (for actions with multiple possible products like gem mining)
  if (task.action.dropTable) {
    const bankingEnabled = task.bankingEnabled || false

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
        if (newInv.indexOf(null) === -1) {
          if (remainingTicks < bankDelayTicks) break
          remainingTicks -= bankDelayTicks
          for (let i = 0; i < newInv.length; i++) {
            if (!newInv[i]) continue
            itemsBanked[newInv[i].itemId] = (itemsBanked[newInv[i].itemId] || 0) + newInv[i].quantity
            newInv[i] = null
          }
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
    const bankingEnabled = task.bankingEnabled || false
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
        if (newInv.indexOf(null) === -1) {
          if (remainingTicks < bankDelayTicks) break
          remainingTicks -= bankDelayTicks
          for (let i = 0; i < newInv.length; i++) {
            if (!newInv[i]) continue
            itemsBanked[newInv[i].itemId] = (itemsBanked[newInv[i].itemId] || 0) + newInv[i].quantity
            newInv[i] = null
          }
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
    } else {
      // Banking disabled: items fill inventory, excess is dropped (preserves XP/hr, limits items/hr)
      const item = itemsData[product]
      const stackable = item?.stackable || false
      let remainingQty = (task.action.productQty || 1) * actions

      for (let a = 0; a < actions; a++) {
        const qtyThisAction = qtyPerAction
        let addedQty = 0

        if (stackable) {
          const existingIdx = newInv.findIndex(s => s && s.itemId === product)
          if (existingIdx !== -1) {
            newInv[existingIdx] = { ...newInv[existingIdx], quantity: newInv[existingIdx].quantity + qtyThisAction }
            addedQty = qtyThisAction
          } else {
            const emptyIdx = newInv.indexOf(null)
            if (emptyIdx !== -1) {
              newInv[emptyIdx] = { itemId: product, quantity: qtyThisAction }
              addedQty = qtyThisAction
            }
          }
        } else {
          // Non-stackable
          for (let q = 0; q < qtyThisAction; q++) {
            const emptyIdx = newInv.indexOf(null)
            if (emptyIdx !== -1) {
              newInv[emptyIdx] = { itemId: product, quantity: 1 }
              addedQty++
            }
          }
        }

        const droppedQty = qtyThisAction - addedQty
        if (droppedQty > 0) {
          itemsDropped[product] = (itemsDropped[product] || 0) + droppedQty
        }
      }

      // Items still in inventory go to itemsGained
      for (const slot of newInv) {
        if (!slot) continue
        const startingQty = startingInvState[slot.itemId] || 0
        const deltaQty = slot.quantity - startingQty
        if (deltaQty > 0) {
          itemsGained[slot.itemId] = (itemsGained[slot.itemId] || 0) + deltaQty
        }
      }
    }
  }

  return { xpGained, itemsGained, itemsBanked, itemsConsumed, itemsDropped, actions, skill: task.skill, actionName: task.action.name, finalInventory: newInv }
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
export function simulateIdleGather(task, elapsedMs, inventory = [], stats = {}, itemsData = {}) {
  if (!task || !task.gatherTask) return null

  const totalTicks = Math.floor(elapsedMs / TICK_MS)
  const actionTicks = task.gatherTask.ticks
  const actions = Math.floor(totalTicks / actionTicks)
  if (actions <= 0) return null

  // Gather always has banking enabled
  const bankingEnabled = true
  const bankDelayTicks = Math.ceil(getAgilityBankDelayFromStats(stats) / TICK_MS)

  const itemsGained = {}
  const itemsBanked = {}
  const itemsDropped = {}
  const newInv = [...inventory]
  let remainingTicks = totalTicks
  const product = task.gatherTask.product
  const qtyPerAction = task.gatherTask.qty || 1

  // Track starting inventory state for delta calculation
  const startingInvState = {}
  for (const slot of inventory) {
    if (!slot) continue
    startingInvState[slot.itemId] = (startingInvState[slot.itemId] || 0) + slot.quantity
  }

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
      // Non-stackable: place one item per slot
      for (let q = 0; q < qtyPerAction; q++) {
        const emptyIdx = newInv.indexOf(null)
        if (emptyIdx !== -1) {
          newInv[emptyIdx] = { itemId: product, quantity: 1 }
        } else {
          itemsDropped[product] = (itemsDropped[product] || 0) + 1
        }
      }
    }

    // Auto-bank trip: if inventory is full, bank EVERYTHING (like a real trip)
    if (bankingEnabled && newInv.indexOf(null) === -1) {
      if (remainingTicks < bankDelayTicks) break
      remainingTicks -= bankDelayTicks
      for (let i = 0; i < newInv.length; i++) {
        if (!newInv[i]) continue
        itemsBanked[newInv[i].itemId] = (itemsBanked[newInv[i].itemId] || 0) + newInv[i].quantity
        newInv[i] = null
      }
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

  return { itemsGained, itemsBanked, itemsDropped, actions: actionsCompleted, actionName: task.gatherTask.name, finalInventory: newInv }
}

/**
 * Compute average player DPS against a monster.
 * Returns { avgDmgPerHit, weaponSpeed, acc, combatType } so callers can use per-hit granularity.
 */
function avgHitStats(playerStats, equipment, monster, stance, itemsData, spell = null) {
  const bonuses = getEquipmentBonuses(equipment, itemsData)
  const weaponSpeed = getAttackSpeed(equipment, itemsData)
  const combatType = getCombatType(equipment, itemsData)

  let maxHit, atkRoll, defRoll, acc

  if (combatType === 'ranged') {
    const styleBonus = getRangedStyleBonus(stance)
    const effRng = effectiveRanged(playerStats.ranged, 0, 1.0, styleBonus)
    maxHit = rangedMaxHit(effRng, bonuses.otherBonus.rangedStrength)
    atkRoll = maxAttackRoll(effRng, bonuses.attackBonus.ranged || 0)
    defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus?.ranged || 0)
  } else if (combatType === 'magic') {
    const weaponEntry = equipment?.weapon
    const weaponItem = weaponEntry ? itemsData[weaponEntry.itemId] : null
    const isPoweredStaff = !!weaponItem?.poweredStaff
    if (!spell && !isPoweredStaff) return { avgDmgPerHit: 0, weaponSpeed, acc: 0, combatType }
    const effMag = effectiveMagic(playerStats.magic || 1)
    // Powered staffs (Sanguinesti, Trident) scale max hit with magic level: floor(magic/3)+9.
    const baseDamage = spell ? spell.baseDamage : Math.max(1, Math.floor((playerStats.magic || 1) / 3) + 9)
    maxHit = magicMaxHit(baseDamage, bonuses.otherBonus.magicDamage || 0)
    atkRoll = maxAttackRoll(effMag, bonuses.attackBonus.magic || 0)
    defRoll = monsterMagicDefenceRoll(monster.stats.magic || 1, monster.stats.defence, monster.defenceBonus?.magic || 0)
  } else {
    // Melee (default)
    const weaponStyle = getAttackStyle(equipment, itemsData)
    const styleBonuses = getMeleeStyleBonuses(stance)
    const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
    maxHit = meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength)
    const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
    atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
    defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus?.[weaponStyle] || 0)
  }

  acc = hitChance(atkRoll, defRoll)
  const avgDmgPerHit = acc * (maxHit / 2)
  return { avgDmgPerHit, weaponSpeed, acc, combatType }
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
export function simulateIdleCombat(task, elapsedMs, stats, equipment, inventory, itemsData, slayerTask = null, bank = {}) {
  if (!task || !task.monster) return null

  const monster = task.monster
  // Bosses cannot be idle-fought; require active combat
  if (monster.boss) return null
  const totalTicks = Math.floor(elapsedMs / TICK_MS)
  if (totalTicks <= 0) return null

  const playerStats = {
    attack:   getLevelFromXP(stats.attack?.xp   || 0),
    strength: getLevelFromXP(stats.strength?.xp || 0),
    defence:  getLevelFromXP(stats.defence?.xp  || 0),
    ranged:   getLevelFromXP(stats.ranged?.xp   || 0),
    magic:    getLevelFromXP(stats.magic?.xp    || 0),
  }

  const { avgDmgPerHit, weaponSpeed, combatType } = avgHitStats(playerStats, equipment, monster, task.stance || 'accurate', itemsData, task.spell || null)

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
  let xpPerKill = {}
  if (combatType === 'ranged') {
    if (task.stance === 'longrange') {
      // Longrange splits ranged and defence XP
      xpPerKill.ranged = Math.floor(monster.hitpoints * (RANGED_XP_PER_DAMAGE / 2))
      xpPerKill.defence = Math.floor(monster.hitpoints * (RANGED_XP_PER_DAMAGE / 2))
    } else {
      xpPerKill.ranged = Math.floor(monster.hitpoints * RANGED_XP_PER_DAMAGE)
    }
  } else if (combatType === 'magic' && task.spell) {
    // Base spell XP per cast (hitsNeeded casts to kill) plus 2 XP per damage dealt
    xpPerKill.magic = Math.floor(
      (hitsNeeded < Infinity ? hitsNeeded : 0) * (task.spell.baseXP || 0) +
      monster.hitpoints * MAGIC_XP_PER_DAMAGE
    )
  } else {
    // Melee
    const xpSkill = task.stance === 'aggressive' ? 'strength'
      : task.stance === 'defensive' ? 'defence'
      : 'attack'
    xpPerKill[xpSkill] = Math.floor(monster.hitpoints * MELEE_XP_PER_DAMAGE)
  }
  xpPerKill.hitpoints = Math.floor(monster.hitpoints * HP_XP_PER_DAMAGE)

  // Pre-calculate how many kills are possible given available runes (inventory + bank)
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
  const weaponEntry = equipment?.weapon
  const weaponItem = weaponEntry ? itemsData[weaponEntry.itemId] : null
  const weaponScaleCharged = !!weaponItem?.scaleCharged
  const startingCharges = weaponEntry?.charges || 0
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
  const xpGained   = {}
  let monstersKilled = 0
  let monstersKilledOnTask = 0
  let slayerXpGained = 0
  let remainingTicks = totalTicks

  while (remainingTicks >= ticksPerCycle && monstersKilled < maxKillsFromRunes && monstersKilled < maxKillsFromCharges) {
    remainingTicks -= ticksPerCycle
    monstersKilled++

    // Check if this kill counts toward slayer task — cap at total task count
    if (slayerTask && slayerTask.monsterId === monster.id && monstersKilledOnTask < slayerTask.monstersRemaining) {
      monstersKilledOnTask++
      slayerXpGained += monster.slayerXP || monster.hitpoints // Slayer XP = custom field or monster HP
    }

    // XP for this kill
    for (const [skill, xp] of Object.entries(xpPerKill)) {
      xpGained[skill] = (xpGained[skill] || 0) + xp
    }

    // Consume ammo for ranged combat (one ammo per kill)
    if (combatType === 'ranged' && equipment?.ammo) {
      const ammoSlot = newInv.findIndex(s => s && s.itemId === equipment.ammo.itemId)
      if (ammoSlot !== -1) {
        newInv[ammoSlot].quantity -= 1
        if (newInv[ammoSlot].quantity <= 0) {
          newInv[ammoSlot] = null
        }
      }
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
  if (slayerTask && monstersKilledOnTask > 0) {
    const newRemaining = Math.max(0, slayerTask.monstersRemaining - monstersKilledOnTask)
    if (newRemaining <= 0) {
      // Task complete
      slayerTaskUpdate = { ...slayerTask, monstersRemaining: 0, completed: true }
    } else {
      // Task in progress
      slayerTaskUpdate = { ...slayerTask, monstersRemaining: newRemaining }
    }
  }

  // Track scale charges consumed by the weapon during idle combat
  const chargesConsumed = weaponScaleCharged && hitsNeeded < Infinity
    ? Math.min(startingCharges, hitsNeeded * monstersKilled)
    : 0

  return { xpGained, lootGained, lootLost, lootBanked, runesConsumed, monstersKilled, monstersKilledOnTask, finalInventory: newInv, slayerXpGained, slayerTaskUpdate, chargesConsumed }
}
