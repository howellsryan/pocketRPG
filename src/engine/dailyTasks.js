import dailyTasksData from '../data/dailyTasks.json'
import { GATHERING_SKILLS } from '../utils/constants.js'

export function taskById(id) {
  return dailyTasksData.find(t => t.id === id) ?? null
}

// Returns the progress increment for a game event against a task trigger.
// Returns 0 if the event does not match.
export function matchTaskProgress(task, event) {
  const t = task.trigger ?? task  // task may be a full task object or a trigger-only row
  switch (t.type) {
    case 'monster_kill':
      if (event.kind !== 'monster_kill') return 0
      return t.monsterId === event.monsterId ? event.count ?? 1 : 0

    case 'boss_kill':
      if (event.kind !== 'boss_kill') return 0
      return t.monsterId === event.monsterId ? event.count ?? 1 : 0

    case 'raid_complete':
      if (event.kind !== 'raid_complete') return 0
      if (t.raidId === 'any') return event.count ?? 1
      return t.raidId === event.raidId ? event.count ?? 1 : 0

    case 'skill_produce':
      if (event.kind !== 'skill_produce') return 0
      if (t.skill && t.skill !== event.skill) return 0
      if (t.itemId && t.itemId !== event.itemId) return 0
      return event.count ?? 1

    case 'skill_gather':
      if (event.kind !== 'skill_gather') return 0
      if (t.skill && t.skill !== event.skill) return 0
      if (t.itemId && t.itemId !== event.itemId) return 0
      return event.count ?? 1

    case 'skill_xp':
      if (event.kind !== 'skill_xp') return 0
      if (t.skill && t.skill !== event.skill) return 0
      return event.xp ?? 0

    case 'clue_complete':
      if (event.kind !== 'clue_complete') return 0
      if (t.tier && t.tier !== event.tier) return 0
      return event.count ?? 1

    case 'minigame_complete':
      if (event.kind !== 'minigame_complete') return 0
      if (t.minigameId && t.minigameId !== 'any' && t.minigameId !== event.minigameId) return 0
      return event.count ?? 1

    case 'quest_complete':
      if (event.kind !== 'quest_complete') return 0
      return event.count ?? 1

    case 'slayer_task_complete':
      if (event.kind !== 'slayer_task_complete') return 0
      return event.count ?? 1

    case 'hunter_hunt':
      if (event.kind !== 'hunter_hunt') return 0
      if (t.actionId && t.actionId !== event.actionId) return 0
      return event.count ?? 1

    default:
      return 0
  }
}

export function isComplete(taskState) {
  return (taskState.progress ?? 0) >= (taskState.target ?? 1)
}

// Builds daily-task events for skilling gains applied outside the live
// SkillingScreen loop (idle catch-up, paid skips, background runner).
// `task` is the saved active task ({ type: 'skill', skill } from SkillingScreen,
// or { type: 'gather' } from GatherScreen); `itemsGained` is an itemId → qty map.
export function skillingGainEvents(task, itemsGained) {
  if (!itemsGained) return []
  const skill = task?.type === 'skill' ? task.skill : undefined
  const kind = skill && !GATHERING_SKILLS.includes(skill) ? 'skill_produce' : 'skill_gather'
  const events = []
  for (const [itemId, qty] of Object.entries(itemsGained)) {
    if (qty > 0) events.push({ kind, skill, itemId, count: qty })
  }
  return events
}

// Daily-task events for a completed offline/idle catch-up window (loadGame's
// boot path). Unlike live play and the visibility-return handler — which grant
// XP through grantXP and so emit skill_xp implicitly — this path applies XP
// straight to raw state, so its events must be built explicitly here. Combat/any
// XP is skipped (assigned later via the reward modal); quests grant separately.
export function idleCatchupDailyEvents(task, sim) {
  if (!task || !sim || task.type === 'quest') return []
  const events = []
  if (sim.xpGained) {
    for (const [skill, xp] of Object.entries(sim.xpGained)) {
      const amt = Math.floor(Number(xp) || 0)
      if (skill !== 'combat' && skill !== 'any' && amt > 0) events.push({ kind: 'skill_xp', skill, xp: amt })
    }
  }
  if (task.type === 'combat') {
    if (sim.slayerXpGained > 0) events.push({ kind: 'skill_xp', skill: 'slayer', xp: Math.floor(sim.slayerXpGained) })
    if (sim.monstersKilled > 0 && task.monster?.id) {
      events.push({ kind: task.monster?.boss === true ? 'boss_kill' : 'monster_kill', monsterId: task.monster.id, count: sim.monstersKilled })
    }
    if (sim.slayerTaskUpdate?.completed) events.push({ kind: 'slayer_task_complete' })
  }
  if ((task.type === 'skill' || task.type === 'gather') && sim.itemsGained) {
    events.push(...skillingGainEvents(task, sim.itemsGained))
  }
  if (task.type === 'hunter' && sim.actions > 0 && task.action?.id) {
    events.push({ kind: 'hunter_hunt', actionId: task.action.id, count: sim.actions })
  }
  return events
}
