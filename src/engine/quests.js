import { getLevelFromXP } from './experience.js'

export const QUEST_STATUS = {
  LOCKED: 'locked',
  AVAILABLE: 'available',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed'
}

export function countItemHeld(itemId, bank, inventory) {
  let total = 0
  if (bank && bank[itemId]) total += bank[itemId].quantity || 0
  if (inventory) {
    for (const slot of inventory) {
      if (slot && slot.itemId === itemId && !slot.noted) total += slot.quantity || 0
    }
  }
  return total
}

export function isPrereqMet(quest, questStates) {
  const prereqs = quest.prerequisites || []
  return prereqs.every(qid => questStates[qid] === QUEST_STATUS.COMPLETED)
}

export function areRequirementsMet(quest, { stats, bank, inventory }) {
  const req = quest.requirements
  if (!req) return true
  if (req.skills) {
    for (const { skill, level } of req.skills) {
      const cur = stats?.[skill] ? getLevelFromXP(stats[skill].xp) : 1
      if (cur < level) return false
    }
  }
  if (req.items) {
    for (const { itemId, quantity } of req.items) {
      if (countItemHeld(itemId, bank, inventory) < quantity) return false
    }
  }
  return true
}

export function getObjectiveProgress(objective, { stats, bank, inventory, monsterKillCounts, killProgress }) {
  switch (objective.type) {
    case 'deliver': {
      const have = countItemHeld(objective.itemId, bank, inventory)
      const need = objective.quantity
      return { current: Math.min(have, need), required: need, done: have >= need }
    }
    case 'kill': {
      const progress = killProgress?.[objective.monsterId] || 0
      const total = monsterKillCounts?.[objective.monsterId] || 0
      const current = Math.min(progress, objective.quantity)
      return { current, required: objective.quantity, done: progress >= objective.quantity, totalKilled: total }
    }
    case 'level': {
      const cur = stats?.[objective.skill] ? getLevelFromXP(stats[objective.skill].xp) : 1
      return { current: Math.min(cur, objective.level), required: objective.level, done: cur >= objective.level }
    }
    default:
      return { current: 0, required: 1, done: false }
  }
}

export function areObjectivesComplete(quest, ctx) {
  return quest.objectives.every(o => getObjectiveProgress(o, ctx).done)
}

export function getQuestStatus(quest, questStates, ctx) {
  const saved = questStates[quest.id]
  if (saved === QUEST_STATUS.COMPLETED) return QUEST_STATUS.COMPLETED
  if (saved === QUEST_STATUS.IN_PROGRESS) return QUEST_STATUS.IN_PROGRESS
  if (!isPrereqMet(quest, questStates)) return QUEST_STATUS.LOCKED
  if (!areRequirementsMet(quest, ctx)) return QUEST_STATUS.LOCKED
  return QUEST_STATUS.AVAILABLE
}

export function canStartQuest(quest, questStates, ctx) {
  return getQuestStatus(quest, questStates, ctx) === QUEST_STATUS.AVAILABLE
}

export function canCompleteQuest(quest, questStates, ctx) {
  if (questStates[quest.id] !== QUEST_STATUS.IN_PROGRESS) return false
  if (!areRequirementsMet(quest, ctx)) return false
  return areObjectivesComplete(quest, ctx)
}

// Consume delivered items from bank first, then inventory. Returns a new
// { bank, inventory } pair — pure, no mutation.
export function consumeDeliverables(quest, bank, inventory) {
  const newBank = { ...bank }
  const newInv = inventory.map(s => s ? { ...s } : null)
  for (const obj of quest.objectives) {
    if (obj.type !== 'deliver') continue
    let remaining = obj.quantity
    if (newBank[obj.itemId]) {
      const take = Math.min(newBank[obj.itemId].quantity, remaining)
      const left = newBank[obj.itemId].quantity - take
      if (left <= 0) delete newBank[obj.itemId]
      else newBank[obj.itemId] = { ...newBank[obj.itemId], quantity: left }
      remaining -= take
    }
    for (let i = 0; i < newInv.length && remaining > 0; i++) {
      const slot = newInv[i]
      if (!slot || slot.itemId !== obj.itemId || slot.noted) continue
      const take = Math.min(slot.quantity, remaining)
      const left = slot.quantity - take
      if (left <= 0) newInv[i] = null
      else newInv[i] = { ...slot, quantity: left }
      remaining -= take
    }
  }
  return { bank: newBank, inventory: newInv }
}

export function getQuestPoints(questStates, questsData) {
  let total = 0
  for (const [qid, status] of Object.entries(questStates)) {
    if (status !== QUEST_STATUS.COMPLETED) continue
    const q = questsData[qid]
    if (q?.rewards?.questPoints) total += q.rewards.questPoints
  }
  return total
}
