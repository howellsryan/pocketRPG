// One kill, one slayer task, three places that own a copy of the task: the solo
// screen (CombatScreen), a co-op member (coopBossEngine) and an open-world
// session (world/server). This is the arithmetic all three share — pure, so it
// can run inside a Durable Object as happily as in a Preact screen.

import { resolveSlayerTaskKill } from './slayerTasks.js'
import { RAID_TASK_META } from './slayerMasters.js'
import { getSlayerTaskReward, getSlayerTaskXpForKill } from './slayerRewards.js'

/** Slayer progress banked in a session but not yet written to the save. A
 * DELTA, like xpGained — the write-back adds it and clears it, so a session
 * written back twice is not paid twice. */
export function emptySlayerCredit() {
  return { pointsEarned: 0, tasksCompleted: 0, masterCompletions: {} }
}

/**
 * Credits one kill against a slayer task.
 *
 * `holder` is `{ task, tasksCompleted, doubleXp }` — whatever the caller keeps
 * its copy of the task in. Returns null when the kill is off-task (the caller
 * changes nothing), otherwise the settled task plus what the player earned.
 * Nothing is mutated: the caller owns where the new task and the credit delta
 * land, because those three call sites store them in three different shapes.
 */
export function creditSlayerTaskKill(holder, monsterId, monstersData, { fromRaidCompletion = false } = {}) {
  const task = holder?.task
  if (!task || !monsterId) return null
  // A raid-completion proxy task is paid by the CLEAR and by nothing else — the
  // same defence-in-depth solo has (CombatScreen's raidTaskCreditBlocked).
  const raidMeta = RAID_TASK_META[task.monsterId]
  if (raidMeta && !fromRaidCompletion) return null
  const result = resolveSlayerTaskKill(task, monsterId, 1)
  if (!result.onTask) return null

  const monster = monstersData?.[monsterId] || null
  const xp = getSlayerTaskXpForKill(monster, monster, monstersData, {
    doubleXp: holder?.doubleXp === true,
    // A raid clear is a whole run, not a boss kill: it pays the authored flat
    // rate, never the final boss's HP through the boss multiplier.
    flatXp: raidMeta?.flatSlayerXp,
  })

  if (!result.completed) {
    return {
      completed: false,
      slayerXp: xp,
      task: result.task,
      monstersRemaining: result.task?.monstersRemaining ?? 0,
    }
  }

  const tasksCompleted = Math.max(0, Math.floor(Number(holder?.tasksCompleted) || 0))
  const reward = getSlayerTaskReward(result.pointsAwarded, tasksCompleted)
  return {
    completed: true,
    slayerXp: xp,
    task: null,
    monstersRemaining: 0,
    pointsEarned: reward.pointsEarned,
    totalTasks: reward.totalTasks,
    masterId: task.masterId || null,
  }
}

/** Folds a completed credit into a running delta (see emptySlayerCredit). */
export function bankSlayerCredit(credit, credited) {
  const next = credit && typeof credit === 'object' ? credit : emptySlayerCredit()
  if (!credited?.completed) return next
  next.pointsEarned = Math.max(0, Math.floor(Number(next.pointsEarned) || 0)) + Math.max(0, Math.floor(Number(credited.pointsEarned) || 0))
  next.tasksCompleted = Math.max(0, Math.floor(Number(next.tasksCompleted) || 0)) + 1
  if (credited.masterId) {
    const completions = next.masterCompletions && typeof next.masterCompletions === 'object' ? next.masterCompletions : {}
    completions[credited.masterId] = (Math.floor(Number(completions[credited.masterId]) || 0)) + 1
    next.masterCompletions = completions
  }
  return next
}
