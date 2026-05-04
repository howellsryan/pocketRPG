export function getSlayerTaskReward(basePoints, completedTasksBeforeCompletion = 0) {
  const base = Math.max(0, Math.floor(Number(basePoints) || 0))
  const totalTasks = Math.max(0, Math.floor(Number(completedTasksBeforeCompletion) || 0)) + 1
  let multiplier = 1
  if (totalTasks % 50 === 0) multiplier = 50
  else if (totalTasks % 5 === 0) multiplier = 10
  return { totalTasks, multiplier, pointsEarned: base * multiplier }
}
