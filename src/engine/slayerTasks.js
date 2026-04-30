export function resolveSlayerTaskKill(task, monsterId, killCount = 1) {
  if (!task || !monsterId || task.monsterId !== monsterId) {
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
