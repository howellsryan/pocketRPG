import dailyTasksData from '../data/dailyTasks.json'

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

    default:
      return 0
  }
}

export function isComplete(taskState) {
  return (taskState.progress ?? 0) >= (taskState.target ?? 1)
}
