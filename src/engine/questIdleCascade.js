import { TICK_DURATION } from '../utils/constants.js'
import { simulateIdleQuest } from './quests.js'

function normaliseElapsedMs(elapsedMs) {
  const parsed = Number(elapsedMs)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.floor(parsed)
}

function questTotalTicks(quest) {
  return Math.max(1, Math.ceil((Number(quest?.durationSeconds) || 0) * 1000 / TICK_DURATION))
}

export function createQueuedQuestTask(quest, ticksRemaining = null, now = Date.now()) {
  const totalTicks = questTotalTicks(quest)
  const parsedRemaining = Number(ticksRemaining)
  return {
    type: 'quest',
    quest,
    totalTicks,
    ticksRemaining: Number.isFinite(parsedRemaining)
      ? Math.max(0, Math.min(totalTicks, Math.floor(parsedRemaining)))
      : totalTicks,
    startedAt: now,
  }
}

export function splitQuestXpRewards(xpReward = {}) {
  const fixed = {}
  const choices = []

  for (const [skill, rawXp] of Object.entries(xpReward || {})) {
    const xp = Math.floor(Number(rawXp) || 0)
    if (xp <= 0) continue

    if (skill === 'combat' || skill === 'any') {
      choices.push({ type: skill, amount: xp })
    } else {
      fixed[skill] = (fixed[skill] || 0) + xp
    }
  }

  return { fixed, choices }
}

export function simulateQuestIdleCascade({ activeTask, questQueue = [], elapsedMs, now = Date.now() }) {
  const safeElapsedMs = normaliseElapsedMs(elapsedMs)
  const finalQueue = Array.isArray(questQueue) ? [...questQueue] : []
  const completed = []

  if (!activeTask || activeTask.type !== 'quest' || !activeTask.quest || safeElapsedMs <= 0) {
    return {
      completed,
      finalTask: activeTask ?? null,
      finalQueue,
      elapsedMsUsed: 0,
      elapsedMsRemaining: safeElapsedMs,
    }
  }

  let remainingMs = safeElapsedMs
  let currentTask = {
    ...activeTask,
    totalTicks: activeTask.totalTicks || questTotalTicks(activeTask.quest),
    ticksRemaining: activeTask.ticksRemaining ?? activeTask.totalTicks ?? questTotalTicks(activeTask.quest),
  }

  while (currentTask && remainingMs > 0) {
    const sim = simulateIdleQuest(currentTask, remainingMs)
    if (!sim) break

    const ticksUsed = Math.max(0, Number(sim.ticksUsed || 0) || 0)
    remainingMs = Math.max(0, remainingMs - ticksUsed * TICK_DURATION)

    if (sim.completed) {
      completed.push({
        quest: currentTask.quest,
        xpReward: { ...(currentTask.quest.xpReward || {}) },
        coinReward: Number(currentTask.quest.coinReward || 0) || 0,
        itemUnlocks: [...(currentTask.quest.itemUnlocks || [])],
      })

      const nextQuest = finalQueue.shift()
      currentTask = nextQuest ? createQueuedQuestTask(nextQuest, null, now) : null
      continue
    }

    currentTask = {
      ...currentTask,
      ticksRemaining: sim.ticksRemaining,
      startedAt: now,
    }
    break
  }

  return {
    completed,
    finalTask: currentTask,
    finalQueue,
    elapsedMsUsed: safeElapsedMs - remainingMs,
    elapsedMsRemaining: remainingMs,
  }
}
