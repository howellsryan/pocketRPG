export const DAGANNOTH_KINGS_TASK_ID = 'dagganoth_kings'
const DAGANNOTH_KINGS = new Set(['nagadoth_rex', 'nagadoth_prime', 'nagadoth_supreme'])

// Slayer points spent to skip (cancel) the current task without a credit.
export const SLAYER_TASK_SKIP_POINT_COST = 30

export function doesSlayerTaskMatchMonster(taskMonsterId, monsterId) {
  if (!taskMonsterId || !monsterId) return false
  if (taskMonsterId === monsterId) return true
  if (taskMonsterId === DAGANNOTH_KINGS_TASK_ID && DAGANNOTH_KINGS.has(monsterId)) return true
  if (monsterId === DAGANNOTH_KINGS_TASK_ID && DAGANNOTH_KINGS.has(taskMonsterId)) return true
  return DAGANNOTH_KINGS.has(taskMonsterId) && DAGANNOTH_KINGS.has(monsterId)
}

export function resolveSlayerTaskKill(task, monsterId, killCount = 1) {
  if (!task || !doesSlayerTaskMatchMonster(task.monsterId, monsterId)) {
    return {
      onTask: false,
      completed: false,
      task,
      killsApplied: 0,
      pointsAwarded: 0,
    }
  }

  const kills = Math.max(0, Math.floor(Number(killCount) || 0))
  if (kills <= 0) {
    return {
      onTask: true,
      completed: false,
      task,
      killsApplied: 0,
      pointsAwarded: 0,
    }
  }

  const remainingBefore = Math.max(0, Math.floor(Number(task.monstersRemaining) || 0))
  const killsApplied = Math.min(remainingBefore, kills)
  const remainingAfter = Math.max(0, remainingBefore - killsApplied)

  if (remainingAfter <= 0) {
    return {
      onTask: true,
      completed: true,
      task: null,
      killsApplied,
      pointsAwarded: Math.max(0, Math.floor(Number(task.pointsOnComplete) || 0)),
    }
  }

  return {
    onTask: true,
    completed: false,
    task: {
      ...task,
      monstersRemaining: remainingAfter,
    },
    killsApplied,
    pointsAwarded: 0,
  }
}
