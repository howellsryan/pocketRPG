import { TICK_DURATION } from '../utils/constants.js'

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
  const parsedRemaining = ticksRemaining == null ? null : Number(ticksRemaining)
  return {
    type: 'quest',
    quest,
    totalTicks,
    ticksRemaining: parsedRemaining != null && Number.isFinite(parsedRemaining)
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

  let remainingTicks = Math.floor(safeElapsedMs / TICK_DURATION)
  let currentTask = createQueuedQuestTask(
    activeTask.quest,
    activeTask.ticksRemaining ?? activeTask.totalTicks ?? questTotalTicks(activeTask.quest),
    now
  )

  while (currentTask && remainingTicks > 0) {
    const currentRemaining = Math.max(0, Math.floor(Number(currentTask.ticksRemaining) || 0))
    const ticksUsed = Math.min(currentRemaining, remainingTicks)
    const nextRemaining = Math.max(0, currentRemaining - ticksUsed)
    remainingTicks -= ticksUsed

    if (nextRemaining > 0) {
      currentTask = {
        ...currentTask,
        ticksRemaining: nextRemaining,
        startedAt: now,
      }
      break
    }

    completed.push({
      quest: currentTask.quest,
      xpReward: { ...(currentTask.quest.xpReward || {}) },
      coinReward: Number(currentTask.quest.coinReward || 0) || 0,
      itemUnlocks: [...(currentTask.quest.itemUnlocks || [])],
    })

    const nextQuest = finalQueue.shift()
    currentTask = nextQuest ? createQueuedQuestTask(nextQuest, null, now) : null
  }

  const elapsedMsUsed = (Math.floor(safeElapsedMs / TICK_DURATION) - remainingTicks) * TICK_DURATION

  return {
    completed,
    finalTask: currentTask,
    finalQueue,
    elapsedMsUsed,
    elapsedMsRemaining: Math.max(0, safeElapsedMs - elapsedMsUsed),
  }
}
