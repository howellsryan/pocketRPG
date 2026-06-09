export const DEFAULT_SLAYER_TASK_XP_MULTIPLIER = 2
export const BOSS_SLAYER_TASK_XP_MULTIPLIER = 10

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
