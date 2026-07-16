import { placesForActivity } from './worldContent.js'

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
  let xp
  if (options.flatXp > 0) {
    xp = Math.floor(options.flatXp)
  } else {
    const baseXp = getBaseSlayerXp(defeatedMonster, currentMonster, monstersData)
    const multiplier = isBossMonster(defeatedMonster, currentMonster, monstersData)
      ? BOSS_SLAYER_TASK_XP_MULTIPLIER
      : DEFAULT_SLAYER_TASK_XP_MULTIPLIER
    xp = Math.floor(baseXp * multiplier)
  }
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

// After an auto-slayer chain switches tasks, the player should resume live
// combat on the monster they're now assigned rather than the finished task's
// monster. Returns { monsterId, returnTo, placeId } for the idle-result close
// handler to re-enter combat, or null when there's nothing to switch to (no
// chain, died, non-combat task, or the chain ended on a boss task that can't be
// idled — its finalTaskMonster is cleared, so the player keeps it to fight
// manually). `placeId` is the world place that offers the new monster (or null
// when unmapped): the sim ignores travel, so the caller teleports the player
// there on arrival to keep their location honest with the kills they earned.
export function chainCombatResumeTarget(result) {
  if (!result || !result.autoSlayerChained || result.died) return null
  if (result.task?.type !== 'combat') return null
  const monster = result.finalTaskMonster
  if (!monster?.id) return null
  const places = placesForActivity('combat', monster.id)
  return {
    monsterId: monster.id,
    returnTo: result.task?.returnTo || null,
    placeId: places.length > 0 ? places[0] : null,
  }
}

// Build the display rows for the idle-result "Slayer" card from a combat sim
// result. Auto-slayer chains list one row per completed task (monster + count)
// then the current active task; a single task keeps one row. Resolves the
// monster name defensively so a bare single-sim completion (which only carries
// points, no monsterName) never renders "undefined".
export function buildSlayerResultRows(result) {
  if (!result) return []
  const rows = []
  const completions = Array.isArray(result.slayerCompletions) ? result.slayerCompletions : []
  const totalOnTask = Math.max(0, Math.floor(Number(result.monstersKilledOnTask) || 0))
  const update = result.slayerTaskUpdate

  const activeTaskRow = (task, killed) => {
    if (!task || !task.monsterName) return null
    if (task.isBoss) {
      return { text: `${task.monsterName} — Active Task (boss — can't be idled, fight it yourself)`, active: true }
    }
    const remaining = Math.max(0, Math.floor(Number(task.monstersRemaining) || 0))
    return { text: `${Math.max(0, killed).toLocaleString()} ${task.monsterName} — Active Task · ${remaining.toLocaleString()} left`, active: true }
  }

  if (completions.length > 0) {
    let completedKills = 0
    for (const completion of completions) {
      const name = completion.monsterName || 'monster'
      const count = Math.max(0, Math.floor(Number(completion.count) || 0))
      completedKills += count
      rows.push({ text: `${count.toLocaleString()} ${name} — Task Complete!`, active: false })
    }
    if (update && !update.completed) {
      const row = activeTaskRow(update, totalOnTask - completedKills)
      if (row) rows.push(row)
    }
    return rows
  }

  // Single task this window (auto-slayer off, or one task that didn't roll over).
  if (!update) return rows
  if (update.completed) {
    if (totalOnTask <= 0) return rows
    const name = update.monsterName || result.task?.monster?.name || 'monster'
    rows.push({ text: `${totalOnTask.toLocaleString()} ${name} — Task Complete!`, active: false })
    return rows
  }
  if (update.isBoss) {
    const row = activeTaskRow(update, 0)
    if (row) rows.push(row)
    return rows
  }
  if (totalOnTask <= 0) return rows
  const name = update.monsterName || result.task?.monster?.name || 'monster'
  const remaining = Math.max(0, Math.floor(Number(update.monstersRemaining) || 0))
  rows.push({ text: `${totalOnTask.toLocaleString()} ${name} / ${remaining.toLocaleString()} remaining`, active: false })
  return rows
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
