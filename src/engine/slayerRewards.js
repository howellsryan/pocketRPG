export const DEFAULT_SLAYER_TASK_XP_MULTIPLIER = 2
// Bosses are tanky (high HP + high defence) so a kill takes far longer than a
// regular monster's. Because Slayer XP/kill scales with the target's HP while
// time-to-kill also scales with HP, a flat multiplier keeps Slayer XP/hour
// roughly constant across targets. ×4 keeps a boss at most ~2× the best regular
// monster's Slayer XP/hour once their heavier defence is accounted for — a
// reward premium without the previous drastic (×10 + inflated slayerXP) spike.
export const BOSS_SLAYER_TASK_XP_MULTIPLIER = 4

function asPositiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function resolveMonsterRewardData(defeatedMonster, currentMonster, monstersData = {}) {
  if (defeatedMonster?.id && monstersData?.[defeatedMonster.id]) {
    return monstersData[defeatedMonster.id]
  }

  if (currentMonster?.id && monstersData?.[currentMonster.id]) {
    return monstersData[currentMonster.id]
  }

  return defeatedMonster || currentMonster || null
}

export function isBossMonster(defeatedMonster, currentMonster, monstersData = {}) {
  const monster = resolveMonsterRewardData(defeatedMonster, currentMonster, monstersData)
  return monster?.boss === true
}

export function getBaseSlayerXp(defeatedMonster, currentMonster, monstersData = {}) {
  const monster = resolveMonsterRewardData(defeatedMonster, currentMonster, monstersData)

  return (
    asPositiveNumber(monster?.slayerXP) ||
    asPositiveNumber(monster?.hitpoints) ||
    asPositiveNumber(currentMonster?.slayerXP) ||
    asPositiveNumber(currentMonster?.hitpoints)
  )
}

export function getSlayerTaskXpForKill(defeatedMonster, currentMonster, monstersData = {}, options = {}) {
  const baseXp = getBaseSlayerXp(defeatedMonster, currentMonster, monstersData)
  const multiplier = isBossMonster(defeatedMonster, currentMonster, monstersData)
    ? BOSS_SLAYER_TASK_XP_MULTIPLIER
    : DEFAULT_SLAYER_TASK_XP_MULTIPLIER

  const xp = Math.floor(baseXp * multiplier)
  return options.doubleXp ? Math.floor(xp * 2) : xp
}

export function getSlayerTaskReward(basePoints, completedTasksBeforeCompletion = 0) {
  const base = Math.max(0, Math.floor(Number(basePoints) || 0))
  const totalTasks = Math.max(0, Math.floor(Number(completedTasksBeforeCompletion) || 0)) + 1
  let multiplier = 1
  if (totalTasks % 50 === 0) multiplier = 50
  else if (totalTasks % 5 === 0) multiplier = 10
  return { totalTasks, multiplier, pointsEarned: base * multiplier }
}

// Fold a run of auto-slayer task completions (from simulateIdleCombatChain's
// `slayerCompletions`) into a single reward summary. Each completion advances
// the streak counter so the ×10 / ×50 milestone bonuses land correctly across
// the whole chain. Returns the running total, the points to award, and a
// per-task breakdown for messaging.
export function resolveSlayerLoopRewards(completions, tasksCompletedStart = 0) {
  let totalTasks = Math.max(0, Math.floor(Number(tasksCompletedStart) || 0))
  let pointsEarned = 0
  const rewards = []
  for (const completion of (completions || [])) {
    const reward = getSlayerTaskReward(completion?.pointsOnComplete, totalTasks)
    totalTasks = reward.totalTasks
    pointsEarned += reward.pointsEarned
    rewards.push(reward)
  }
  return { totalTasks, pointsEarned, rewards }
}
