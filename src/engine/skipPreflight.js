import { getEffectiveToolActionTicks } from './skilling.js'
import { getRunesToConsume } from './runes.js'

export const SKIP_HOUR_MS = 60 * 60 * 1000
export const TICK_MS = 600

export function countInventoryItem(inventory = [], itemId, predicate = null) {
  return (inventory || []).reduce((sum, slot) => {
    if (!slot || slot.itemId !== itemId) return sum
    if (predicate && !predicate(slot)) return sum
    return sum + (slot.quantity || 0)
  }, 0)
}
export function countBankItem(bank = {}, itemId) { return bank?.[itemId]?.quantity || 0 }
export function countAvailableItem({ inventory = [], bank = {}, equipment = null }, itemId, options = {}) {
  const includeEquipped = options.includeEquipped !== false
  let total = countInventoryItem(inventory, itemId) + countBankItem(bank, itemId)
  if (includeEquipped && equipment) {
    for (const slot of Object.values(equipment)) if (slot?.itemId === itemId) total += (slot.quantity || 1)
  }
  return total
}
const totalTicksForElapsed = (elapsedMs) => Math.floor(Math.max(0, elapsedMs) / TICK_MS)
const actionsFromTicks = (elapsedMs, actionTicks) => Math.floor(totalTicksForElapsed(elapsedMs) / Math.max(1, Math.floor(Number(actionTicks) || 0)))
const valid = (actionCount, kind, reason = '') => ({ canSkip: true, shouldStopTask: false, reason, actionCount: Math.max(0, Math.floor(actionCount || 0)), kind })
const invalid = (reason, kind, shouldStopTask = true) => ({ canSkip: false, shouldStopTask, reason, actionCount: 0, kind })

function capByMaterials(materials, context) {
  let max = Infinity
  for (const [itemId, qty] of Object.entries(materials || {})) {
    const possible = Math.floor(countAvailableItem(context, itemId, { includeEquipped: false }) / Math.max(1, qty))
    if (possible < max) max = possible
  }
  return max
}

function getGatherSkipPreflight(activeTask, context, elapsedMs) {
  const task = activeTask?.gatherTask
  if (!task) return invalid('No gather action is active.', 'gather')
  if (task.oneShot) {
    const remaining = Number(activeTask.ticksRemaining ?? task.ticks ?? 0)
    return remaining > 0 ? valid(1, 'gather:oneshot') : invalid(`${task.name || 'This activity'} is already complete.`, 'gather:oneshot', true)
  }
  let possibleActions = actionsFromTicks(elapsedMs, task.ticks)
  if (possibleActions <= 0) return invalid('This action cannot progress from a 1 hour skip.', 'gather', false)
  if (task.isClue) {
    const availableScrolls = countBankItem(context.bank, task.requiresItem)
    const count = Math.min(possibleActions, availableScrolls)
    if (count <= 0) return invalid('No clue scrolls left for this action.', 'gather:clue', true)
    return valid(count, 'gather:clue')
  }
  if (task.requiresItem && countAvailableItem(context, task.requiresItem) <= 0) return invalid('Required item is missing for this action.', 'gather:item', true)
  if (task.materials) possibleActions = Math.min(possibleActions, capByMaterials(task.materials, context))
  if (task.gpCost) possibleActions = Math.min(possibleActions, Math.floor(countAvailableItem(context, 'coins') / task.gpCost))
  if (possibleActions <= 0) return invalid(task.gpCost ? 'Not enough coins for this action.' : 'Out of materials for this action.', 'gather:resources', true)
  return valid(possibleActions, 'gather')
}

function getSkillSkipPreflight(activeTask, context, elapsedMs) {
  const action = activeTask?.action
  if (!action || !activeTask?.skill) return invalid('No skilling action is active.', 'skill')
  const effectiveTicks = getEffectiveToolActionTicks(activeTask.skill, action.ticks, context.equipment, context.itemsData || {}, context.stats || {}, context.inventory || [])
  let possibleActions = actionsFromTicks(elapsedMs, effectiveTicks)
  if (possibleActions <= 0) return invalid('This action cannot progress from a 1 hour skip.', 'skill', false)
  if (action.materials) possibleActions = Math.min(possibleActions, capByMaterials(action.materials, context))
  if (action.runeReq) {
    const runesToConsume = getRunesToConsume(action.runeReq, context.equipment, context.itemsData || {})
    for (const [runeId, qty] of Object.entries(runesToConsume)) {
      possibleActions = Math.min(possibleActions, Math.floor(countAvailableItem(context, runeId, { includeEquipped: false }) / qty))
    }
  }
  if (action.type === 'alchemy') {
    const selected = activeTask.selectedAlchemyItem
    if (!selected?.itemId) return invalid('Select an item to alchemize first.', 'skill:alchemy', true)
    const avail = countInventoryItem(context.inventory, selected.itemId, (slot) => !!slot?.noted === !!selected.noted)
    possibleActions = Math.min(possibleActions, avail)
  }
  if (action.itemReq) {
    const req = Array.isArray(action.itemReq) ? action.itemReq : [action.itemReq]
    const hasAny = req.some((id) => countAvailableItem(context, id) > 0)
    if (!hasAny) return invalid('Required item is missing for this action.', 'skill:itemreq', true)
  }
  if (possibleActions <= 0) return invalid('Out of materials for this action.', 'skill:resources', true)
  return valid(possibleActions, 'skill')
}

export function getSkipPreflight(activeTask, context, elapsedMs = SKIP_HOUR_MS) {
  if (!activeTask?.type) return invalid('Start an action before using Skip 1h.', 'none', false)
  if (activeTask.type === 'gather') return getGatherSkipPreflight(activeTask, context, elapsedMs)
  if (activeTask.type === 'skill') return getSkillSkipPreflight(activeTask, context, elapsedMs)
  if (activeTask.type === 'quest') return (Number(activeTask.ticksRemaining || 0) > 0 || (context.questQueue || []).length > 0) ? valid(1, 'quest') : invalid('No quest time remains to skip.', 'quest', true)
  if (activeTask.type === 'combat' && (activeTask.monster?.boss || activeTask.raid)) return invalid('Cannot skip boss/raid combat.', 'combat', false)
  const ticks = activeTask.action?.ticks || activeTask.npc?.ticks || activeTask.monster?.speed || 4
  return actionsFromTicks(elapsedMs, ticks) > 0 ? valid(actionsFromTicks(elapsedMs, ticks), activeTask.type) : invalid('This action cannot progress from a 1 hour skip.', activeTask.type, false)
}

export function isChargeableSkipOutcome(activeTask, outcome) {
  if (!activeTask || !outcome) return false
  if (activeTask.type === 'quest') return !!outcome.questCascade && (((outcome.completedQuests || []).length > 0) || (outcome.elapsedMsUsed || 0) > 0 || !!outcome.finalTask || !!outcome.task)
  if (activeTask.type === 'gather' && activeTask.gatherTask?.oneShot) return !!outcome.minigameCompleted || !!outcome.minigameTimeReduced
  if (activeTask.type === 'minigame') return !!outcome.minigameCompleted || !!outcome.minigameTimeReduced
  if (Number(outcome.actions || 0) > 0) return true
  if (Number(outcome.monstersKilled || 0) > 0) return true
  if (activeTask.type === 'combat' && Number(outcome.hpRestored || 0) > 0) return true
  return false
}
