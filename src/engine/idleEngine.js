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
import { getEquipmentBonuses, getAttackSpeed, getAttackStyle, getCombatType, getRangedAmmoRequirementFailure } from './equipment.js'
import { getEffectiveToolActionTicks } from './skilling.js'
import { hasRequiredRunes, getRunesToConsume } from './runes.js'
import { MELEE_XP_PER_DAMAGE, RANGED_XP_PER_DAMAGE, MAGIC_XP_PER_DAMAGE, HP_XP_PER_DAMAGE } from '../utils/constants.js'
import { getAgilityBankDelayFromStats, simulateIdleAgility } from './agility.js'
import { rollClueRewards } from './clueScrolls.js'
import { resolveSlayerTaskKill } from './slayerTasks.js'
import { calculateDungeoneeringTokensForAction } from './dungeoneeringTokens.js'
import { getSlayerTaskEquipmentBonuses } from './slayerCombatBonuses.js'

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

    return {
      xpGained: {},
      itemsGained: completed && product ? { [product]: 1 } : {},
      itemsBanked: completed && product ? { [product]: 1 } : {},
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
  const actionTicks = getEffectiveToolActionTicks(task.skill, task.action.ticks, equipment, itemsData, stats, inventory)

  let actions = Math.floor(totalTicks / actionTicks)
  if (actions <= 0) return null

  const itemsConsumed = {}

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

  // Handle alchemy (converts items to coins)
  let coinsGained = 0
  if (task.action.type === 'alchemy' && task.selectedAlchemyItem) {
    const alchItem = itemsData[task.selectedAlchemyItem.itemId]
    if (alchItem && typeof alchItem.shopValue === 'number') {
      const coinsPerAction = alchItem.shopValue >= 100000
        ? Math.floor(alchItem.shopValue * 1.1)
        : Math.floor(alchItem.shopValue * 1.5)
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

  const dungeoneeringTokensGained = task.skill === 'dungeoneering' && task.action?.category !== 'reward'
    ? calculateDungeoneeringTokensForAction(task.action) * actions
    : 0

  return { xpGained, itemsGained, itemsBanked, itemsConsumed, itemsDropped, actions, skill: task.skill, actionName: task.action.name, finalInventory: newInv, coinsGained, dungeoneeringTokensGained }
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
export function simulateIdleGather(task, elapsedMs, inventory = [], stats = {}, itemsData = {}, bank = {}) {
  if (!task || !task.gatherTask) return null
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

  // Cap actions to available materials in bank
  if (task.gatherTask.materials) {
    let maxFromMaterials = Infinity
    for (const [itemId, qtyPerAction] of Object.entries(task.gatherTask.materials)) {
      const available = (bank && bank[itemId]) ? bank[itemId].quantity : 0
      const possible = Math.floor(available / qtyPerAction)
      if (possible < maxFromMaterials) maxFromMaterials = possible
    }
    if (maxFromMaterials === 0) return null
    actions = Math.min(actions, maxFromMaterials)

    // Record consumed materials
    for (const [itemId, qtyPerAction] of Object.entries(task.gatherTask.materials)) {
      itemsConsumed[itemId] = qtyPerAction * actions
    }
  }

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

  return { itemsGained, itemsBanked, itemsDropped, itemsConsumed, actions: actionsCompleted, actionName: task.gatherTask.name, finalInventory: newInv }
}

/**
 * Compute average player DPS against a monster.
 * Returns { avgDmgPerHit, weaponSpeed, acc, combatType } so callers can use per-hit granularity.
 */
function avgHitStats(playerStats, equipment, monster, stance, itemsData, spell = null, slayerTask = null) {
  const bonuses = getEquipmentBonuses(equipment, itemsData)
  const slayerEquipmentBonus = getSlayerTaskEquipmentBonuses({ equipment, itemsData, slayerTask, monsterId: monster.id })
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
export function simulateIdleCombat(task, elapsedMs, stats, equipment, inventory, itemsData, slayerTask = null, bank = {}, idleLoadout = null) {
  if (!task || !task.monster) return null

  const monster = task.monster
  // Block boss and raid fights; allow normal monsters to idle
  if (monster.boss === true || task.raid === true) return null
  const totalTicks = Math.floor(elapsedMs / TICK_MS)
  if (totalTicks <= 0) return null

  const playerStats = {
    attack:   getLevelFromXP(stats.attack?.xp   || 0),
    strength: getLevelFromXP(stats.strength?.xp || 0),
    defence:  getLevelFromXP(stats.defence?.xp  || 0),
    ranged:   getLevelFromXP(stats.ranged?.xp   || 0),
    magic:    getLevelFromXP(stats.magic?.xp    || 0),
  }

  const { avgDmgPerHit, weaponSpeed, combatType } = avgHitStats(playerStats, equipment, monster, task.stance || 'accurate', itemsData, task.spell || null, slayerTask)
  const rangedAmmoFailure = combatType === 'ranged' ? getRangedAmmoRequirementFailure(equipment, itemsData) : null
  if (rangedAmmoFailure) {
    return { xpGained: {}, lootGained: {}, monstersKilled: 0, lootLost: {}, lootBanked: {} }
  }

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
  const weaponEntry = equipment?.weapon
  const weaponItem = weaponEntry ? itemsData[weaponEntry.itemId] : null

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
    const xpSkill = task.stance === 'aggressive' ? 'strength'
      : task.stance === 'defensive' ? 'defence'
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
  let elapsedTicksUsed = 0
  const idleFoodConsumed = {}
  const idlePotionsConsumed = {}
  const loadoutPotions = idleLoadout?.potions || {}
  const basePrayer = Math.max(1, getLevelFromXP(stats.prayer?.xp || 0))
  let prayerPoints = basePrayer
  const activeProtectionPrayer = idleLoadout?.prayers?.protection || null
  const activeCombatPrayer = idleLoadout?.prayers?.combat || null
  const monsterAttackSpeed = Math.max(2, Number(monster.attackSpeed || 4))

  const maxKillsFromResources = Math.min(maxKillsFromAmmo, maxKillsFromRunes, maxKillsFromCharges)

  // Optional survivability cap for idle/skip: consume configured idle food as HP buffer.
  const baseHp = Math.max(1, getLevelFromXP(stats.hitpoints?.xp || 0))
  const loadoutFood = idleLoadout?.food || {}
  let extraHpBuffer = 0
  for (const [itemId, qty] of Object.entries(loadoutFood)) {
    const item = itemsData[itemId]
    const heal = Math.max(0, Math.floor(Number(item?.foodHeal) || 0))
    const count = Math.max(0, Math.floor(Number(qty) || 0))
    if (heal > 0 && count > 0) extraHpBuffer += heal * count
  }
  let hpPool = baseHp + extraHpBuffer

  const rawIncomingPerKill = Math.max(0, Math.floor((monster.maxHit || 0) * Math.max(1, hitsNeeded) / 2))
  const monsterHitsPerKill = Math.max(1, Math.floor(ticksPerKill / monsterAttackSpeed))
  const playerHitsPerKill = Math.max(1, hitsNeeded)
  const protectionWorksOnMelee = activeProtectionPrayer === 'protection_from_melee' && (monster.attackStyle === 'melee' || !monster.attackStyle)

  while (remainingTicks >= ticksPerCycle && monstersKilled < maxKillsFromResources) {
    let incomingPerKill = rawIncomingPerKill
    // Prayer drain model: combat prayers drain on player hit attempts, protection on monster hit attempts.
    if (activeCombatPrayer) prayerPoints = Math.max(0, prayerPoints - playerHitsPerKill)
    if (protectionWorksOnMelee) {
      const drain = Math.min(prayerPoints, monsterHitsPerKill)
      prayerPoints -= drain
      if (drain >= monsterHitsPerKill) incomingPerKill = 0
    }
    while (prayerPoints <= 0) {
      const srLeft = Math.max(0, (loadoutPotions.super_restore || 0) - (idlePotionsConsumed.super_restore || 0))
      const ppLeft = Math.max(0, (loadoutPotions.prayer_potion || 0) - (idlePotionsConsumed.prayer_potion || 0))
      if (srLeft > 0) {
        idlePotionsConsumed.super_restore = (idlePotionsConsumed.super_restore || 0) + 1
        prayerPoints = Math.min(basePrayer, prayerPoints + 20)
        continue
      }
      if (ppLeft > 0) {
        idlePotionsConsumed.prayer_potion = (idlePotionsConsumed.prayer_potion || 0) + 1
        prayerPoints = Math.min(basePrayer, prayerPoints + 15)
        continue
      }
      break
    }
    if (incomingPerKill > 0) {
      if (hpPool <= incomingPerKill) break
      hpPool -= incomingPerKill
      // Greedy accounting of food consumed in order of largest heal first.
      let damageCoveredByFood = Math.max(0, baseHp + extraHpBuffer - hpPool - baseHp)
      if (damageCoveredByFood > 0) {
        const byHeal = Object.entries(loadoutFood)
          .map(([itemId, qty]) => ({ itemId, qty: Math.max(0, Math.floor(Number(qty) || 0)), heal: Math.max(0, Math.floor(Number(itemsData[itemId]?.foodHeal) || 0)) }))
          .filter(x => x.heal > 0 && x.qty > 0)
          .sort((a, b) => b.heal - a.heal)
        for (const f of byHeal) {
          const already = idleFoodConsumed[f.itemId] || 0
          const left = Math.max(0, f.qty - already)
          if (left <= 0) continue
          const need = Math.ceil(damageCoveredByFood / f.heal)
          const take = Math.min(left, need)
          if (take > 0) {
            idleFoodConsumed[f.itemId] = already + take
            damageCoveredByFood = Math.max(0, damageCoveredByFood - (take * f.heal))
          }
          if (damageCoveredByFood <= 0) break
        }
      }
    }
    remainingTicks -= ticksPerCycle
    elapsedTicksUsed += ticksPerCycle
    monstersKilled++

    // Check if this kill counts toward slayer task — cap at total task count
    if (slayerTask && slayerTask.monsterId === monster.id && monstersKilledOnTask < slayerTask.monstersRemaining) {
      monstersKilledOnTask++
    }

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
      slayerXpGained = ((monster.slayerXP || monster.hitpoints) * 2) * killsForTask
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

  const resourceLimited = monstersKilled < Math.floor(totalTicks / ticksPerCycle)
    && (maxKillsFromResources !== Infinity)
  const foodConfigured = Object.fromEntries(
    Object.entries(loadoutFood).map(([itemId, qty]) => [itemId, Math.max(0, Math.floor(Number(qty) || 0))])
  )
  const potionConfigured = Object.fromEntries(
    Object.entries(idleLoadout?.potions || {}).map(([itemId, qty]) => [itemId, Math.max(0, Math.floor(Number(qty) || 0))])
  )
  const combatPotionOrder = ['super_combat_potion', 'ranging_potion', 'magic_potion', 'attack_potion', 'strength_potion']
  const elapsedMinutes = (elapsedTicksUsed * TICK_MS) / 60000
  const dosesNeededForUptime = Math.max(0, Math.ceil(elapsedMinutes / 5))
  for (const potionId of combatPotionOrder) {
    const configured = potionConfigured[potionId] || 0
    if (configured <= 0) continue
    idlePotionsConsumed[potionId] = Math.min(configured, dosesNeededForUptime)
    break
  }
  const foodConsumedTotal = Object.values(idleFoodConsumed).reduce((s, v) => s + v, 0)
  const foodConfiguredTotal = Object.values(foodConfigured).reduce((s, v) => s + v, 0)
  const potionsConsumedTotal = Object.values(idlePotionsConsumed).reduce((s, v) => s + v, 0)
  const potionsConfiguredTotal = Object.values(potionConfigured).reduce((s, v) => s + v, 0)

  return {
    xpGained, lootGained, lootLost, lootBanked, runesConsumed, monstersKilled, monstersKilledOnTask, finalInventory: newInv, slayerXpGained, slayerTaskUpdate, chargesConsumed, ammoConsumed, attacksUsed: attacksPerKill * monstersKilled, resourceLimited,
    elapsedMsUsed: elapsedTicksUsed * TICK_MS,
    idleFoodConfigured: foodConfigured,
    idleFoodConsumed,
    idleFoodConsumedTotal: foodConsumedTotal,
    idleFoodConfiguredTotal: foodConfiguredTotal,
    idlePotionsConfigured: potionConfigured,
    idlePotionsConsumed,
    idlePotionsConsumedTotal: potionsConsumedTotal,
    idlePotionsConfiguredTotal: potionsConfiguredTotal,
  }
}
