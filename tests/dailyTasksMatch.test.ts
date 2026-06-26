import { describe, it, expect } from 'vitest'
import { matchTaskProgress, isComplete, taskById } from '../src/engine/dailyTasks.js'

function makeTask(overrides = {}) {
  return {
    taskId: 'test_task',
    tier: 'Novice',
    target: 5,
    progress: 0,
    completed: false,
    trigger: { type: 'monster_kill', monsterId: 'lesser_fiend', target: 5 },
    ...overrides,
  }
}

describe('matchTaskProgress', () => {
  describe('monster_kill', () => {
    it('increments on matching monsterId', () => {
      const task = makeTask()
      expect(matchTaskProgress(task, { kind: 'monster_kill', monsterId: 'lesser_fiend' })).toBe(1)
    })
    it('returns 0 for wrong monsterId', () => {
      const task = makeTask()
      expect(matchTaskProgress(task, { kind: 'monster_kill', monsterId: 'cow' })).toBe(0)
    })
    it('returns 0 for wrong event kind', () => {
      const task = makeTask()
      expect(matchTaskProgress(task, { kind: 'boss_kill', monsterId: 'lesser_fiend' })).toBe(0)
    })
    it('respects count field', () => {
      const task = makeTask()
      expect(matchTaskProgress(task, { kind: 'monster_kill', monsterId: 'lesser_fiend', count: 3 })).toBe(3)
    })
  })

  describe('boss_kill', () => {
    it('increments on matching boss', () => {
      const task = makeTask({ trigger: { type: 'boss_kill', monsterId: 'king_black_dragon', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'boss_kill', monsterId: 'king_black_dragon' })).toBe(1)
    })
    it('returns 0 for monster_kill event', () => {
      const task = makeTask({ trigger: { type: 'boss_kill', monsterId: 'king_black_dragon', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'monster_kill', monsterId: 'king_black_dragon' })).toBe(0)
    })
  })

  describe('raid_complete', () => {
    it('matches any raidId when set to "any"', () => {
      const task = makeTask({ trigger: { type: 'raid_complete', raidId: 'any', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'raid_complete', raidId: 'vaults_of_xyren' })).toBe(1)
    })
    it('matches specific raidId', () => {
      const task = makeTask({ trigger: { type: 'raid_complete', raidId: 'vaults_of_xyren', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'raid_complete', raidId: 'vaults_of_xyren' })).toBe(1)
    })
    it('returns 0 for wrong raidId', () => {
      const task = makeTask({ trigger: { type: 'raid_complete', raidId: 'vaults_of_xyren', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'raid_complete', raidId: 'crimson_night_theatre' })).toBe(0)
    })
  })

  describe('skill_produce', () => {
    it('matches on skill and itemId', () => {
      const task = makeTask({ trigger: { type: 'skill_produce', skill: 'crafting', itemId: 'leather_gloves', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'skill_produce', skill: 'crafting', itemId: 'leather_gloves' })).toBe(1)
    })
    it('returns 0 for wrong skill', () => {
      const task = makeTask({ trigger: { type: 'skill_produce', skill: 'crafting', itemId: 'leather_gloves', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'skill_produce', skill: 'smithing', itemId: 'leather_gloves' })).toBe(0)
    })
    it('returns 0 for wrong itemId', () => {
      const task = makeTask({ trigger: { type: 'skill_produce', skill: 'crafting', itemId: 'leather_gloves', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'skill_produce', skill: 'crafting', itemId: 'iron_boots' })).toBe(0)
    })
  })

  describe('skill_gather', () => {
    it('matches on itemId', () => {
      const task = makeTask({ trigger: { type: 'skill_gather', skill: 'mining', itemId: 'iron_ore', target: 10 } })
      expect(matchTaskProgress(task, { kind: 'skill_gather', skill: 'mining', itemId: 'iron_ore', count: 2 })).toBe(2)
    })
    it('returns 0 if skill does not match', () => {
      const task = makeTask({ trigger: { type: 'skill_gather', skill: 'mining', itemId: 'iron_ore', target: 10 } })
      expect(matchTaskProgress(task, { kind: 'skill_gather', skill: 'woodcutting', itemId: 'iron_ore' })).toBe(0)
    })
  })

  describe('skill_xp', () => {
    it('returns the xp gained for a matching skill', () => {
      const task = makeTask({ trigger: { type: 'skill_xp', skill: 'mining', target: 500 } })
      expect(matchTaskProgress(task, { kind: 'skill_xp', skill: 'mining', xp: 120 })).toBe(120)
    })
    it('returns 0 for a different skill', () => {
      const task = makeTask({ trigger: { type: 'skill_xp', skill: 'mining', target: 500 } })
      expect(matchTaskProgress(task, { kind: 'skill_xp', skill: 'prayer', xp: 120 })).toBe(0)
    })
    it('returns 0 for a non skill_xp event', () => {
      const task = makeTask({ trigger: { type: 'skill_xp', skill: 'mining', target: 500 } })
      expect(matchTaskProgress(task, { kind: 'skill_gather', skill: 'mining', itemId: 'iron_ore' })).toBe(0)
    })
  })

  describe('slayer_task_complete', () => {
    it('increments on matching event', () => {
      const task = makeTask({ trigger: { type: 'slayer_task_complete', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'slayer_task_complete' })).toBe(1)
    })
    it('returns 0 for other events', () => {
      const task = makeTask({ trigger: { type: 'slayer_task_complete', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'monster_kill', monsterId: 'foo' })).toBe(0)
    })
  })

  describe('quest_complete', () => {
    it('increments on matching event', () => {
      const task = makeTask({ trigger: { type: 'quest_complete', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'quest_complete' })).toBe(1)
    })
  })

  describe('minigame_complete', () => {
    it('matches any minigame when not restricted', () => {
      const task = makeTask({ trigger: { type: 'minigame_complete', minigameId: 'any', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'minigame_complete', minigameId: 'castle_wars' })).toBe(1)
    })
    it('matches specific minigame', () => {
      const task = makeTask({ trigger: { type: 'minigame_complete', minigameId: 'castle_wars', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'minigame_complete', minigameId: 'castle_wars' })).toBe(1)
    })
  })
})

// Regression: bare task state from the API (no trigger field) must be looked up
// via taskById before passing to matchTaskProgress.
describe('taskById + matchTaskProgress integration', () => {
  it('matches skill_produce via taskById lookup for craft_leather_body', () => {
    const def = taskById('craft_leather_body')
    expect(def).not.toBeNull()
    expect(matchTaskProgress(def!, { kind: 'skill_produce', skill: 'crafting', itemId: 'leather_body' })).toBe(1)
  })
  it('matches skill_xp via taskById lookup for gain_mining_xp', () => {
    const def = taskById('gain_mining_xp')
    expect(def).not.toBeNull()
    expect(matchTaskProgress(def!, { kind: 'skill_xp', skill: 'mining', xp: 250 })).toBe(250)
  })
  it('returns 0 for unknown taskId', () => {
    expect(taskById('nonexistent_task')).toBeNull()
  })
  it('bare task state (no trigger) returns 0 — lookup must happen before calling matchTaskProgress', () => {
    const bareState = { taskId: 'craft_leather_body', tier: 'Novice', target: 1, progress: 0, completed: false, slot: 0 }
    // Without the trigger, matchTaskProgress correctly returns 0 (caller must do the lookup)
    expect(matchTaskProgress(bareState as any, { kind: 'skill_produce', skill: 'crafting', itemId: 'leather_body' })).toBe(0)
  })
})

describe('isComplete', () => {
  it('returns true when progress >= target', () => {
    expect(isComplete({ progress: 5, target: 5 })).toBe(true)
    expect(isComplete({ progress: 6, target: 5 })).toBe(true)
  })
  it('returns false when progress < target', () => {
    expect(isComplete({ progress: 4, target: 5 })).toBe(false)
    expect(isComplete({ progress: 0, target: 1 })).toBe(false)
  })
  it('handles missing progress/target gracefully', () => {
    expect(isComplete({ progress: 0 })).toBe(false)
    expect(isComplete({})).toBe(false)
  })
})
