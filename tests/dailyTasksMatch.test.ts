import { describe, it, expect } from 'vitest'
import { matchTaskProgress, isComplete, taskById, skillingGainEvents, idleCatchupDailyEvents } from '../src/engine/dailyTasks.js'

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

  describe('clue_complete', () => {
    it('increments on matching tier', () => {
      const task = makeTask({ trigger: { type: 'clue_complete', tier: 'elite', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'clue_complete', tier: 'elite' })).toBe(1)
    })
    it('returns 0 for a different tier', () => {
      const task = makeTask({ trigger: { type: 'clue_complete', tier: 'elite', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'clue_complete', tier: 'hard' })).toBe(0)
    })
    // Regression: clue task objects carry `clueLevel`, not `tier` — emitting
    // `tier: clueTask.tier` (undefined) silently matched nothing in production.
    it('returns 0 when the event tier is missing', () => {
      const task = makeTask({ trigger: { type: 'clue_complete', tier: 'elite', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'clue_complete', tier: undefined })).toBe(0)
      expect(matchTaskProgress(task, { kind: 'clue_complete' })).toBe(0)
    })
    it('matches any tier when the trigger has no tier filter', () => {
      const task = makeTask({ trigger: { type: 'clue_complete', target: 1 } })
      expect(matchTaskProgress(task, { kind: 'clue_complete', tier: 'master' })).toBe(1)
    })
    it('matches every clue daily in the pool from its clueLevel event', () => {
      for (const [taskId, tier] of [
        ['complete_medium_clue', 'medium'],
        ['complete_hard_clue', 'hard'],
        ['complete_elite_clue', 'elite'],
        ['complete_master_clue', 'master'],
      ] as const) {
        const def = taskById(taskId)
        expect(def, taskId).not.toBeNull()
        // The event App.jsx emits on clue completion: tier comes from clueLevel.
        expect(matchTaskProgress(def!, { kind: 'clue_complete', tier }), taskId).toBe(1)
      }
    })
  })

  describe('hunter_hunt', () => {
    it('increments on matching actionId', () => {
      const task = makeTask({ trigger: { type: 'hunter_hunt', actionId: 'hunt_cow', target: 10 } })
      expect(matchTaskProgress(task, { kind: 'hunter_hunt', actionId: 'hunt_cow', count: 3 })).toBe(3)
    })
    it('returns 0 for a different actionId', () => {
      const task = makeTask({ trigger: { type: 'hunter_hunt', actionId: 'hunt_cow', target: 10 } })
      expect(matchTaskProgress(task, { kind: 'hunter_hunt', actionId: 'hunt_jeweller' })).toBe(0)
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

// skillingGainEvents shapes idle/skip/background gains into events the matcher
// accepts — production skills must emit skill_produce with the skill attached,
// gathering skills skill_gather (previously everything was emitted as a
// skill-less skill_gather, matching no task in the pool).
describe('skillingGainEvents', () => {
  it('emits skill_produce for a production skill task and matches the pool', () => {
    const events = skillingGainEvents({ type: 'skill', skill: 'cooking' }, { shrimps: 12 })
    expect(events).toEqual([{ kind: 'skill_produce', skill: 'cooking', itemId: 'shrimps', count: 12 }])
    const def = taskById('cook_shrimps')
    expect(def).not.toBeNull()
    expect(matchTaskProgress(def!, events[0])).toBe(12)
  })
  it('emits skill_gather for a gathering skill task and matches the pool', () => {
    const events = skillingGainEvents({ type: 'skill', skill: 'mining' }, { iron_ore: 7 })
    expect(events).toEqual([{ kind: 'skill_gather', skill: 'mining', itemId: 'iron_ore', count: 7 }])
    const def = taskById('mine_iron_ore')
    expect(def).not.toBeNull()
    expect(matchTaskProgress(def!, events[0])).toBe(7)
  })
  it('emits skill-less skill_gather for GatherScreen chore tasks', () => {
    const events = skillingGainEvents({ type: 'gather' }, { bowstring: 5 })
    expect(events).toEqual([{ kind: 'skill_gather', skill: undefined, itemId: 'bowstring', count: 5 }])
  })
  it('skips zero/negative quantities and handles missing gains', () => {
    expect(skillingGainEvents({ type: 'skill', skill: 'mining' }, { iron_ore: 0, coal: -2 })).toEqual([])
    expect(skillingGainEvents({ type: 'skill', skill: 'mining' }, null)).toEqual([])
    expect(skillingGainEvents({ type: 'skill', skill: 'mining' }, undefined)).toEqual([])
  })
})

// Regression: the cold-boot offline catch-up (loadGame) applies XP/kills to raw
// state instead of going through grantXP, so it emitted NO daily-task events —
// inactive agility and AFK combat never counted toward daily tasks after a
// reload/fresh open. idleCatchupDailyEvents rebuilds the feed the live and
// visibility-return paths produce.
describe('idleCatchupDailyEvents', () => {
  it('emits a skill_xp event for idle agility that advances the agility XP daily', () => {
    const task = { type: 'agility', action: { id: 'gnome_course', name: 'Gnome Course' } }
    const sim = { xpGained: { agility: 5200 }, coinsGained: 40, laps: 20 }
    const events = idleCatchupDailyEvents(task, sim)
    expect(events).toContainEqual({ kind: 'skill_xp', skill: 'agility', xp: 5200 })
    const def = taskById('gain_agility_xp')
    expect(def).not.toBeNull()
    expect(matchTaskProgress(def!, events[0])).toBe(5200)
  })

  it('emits a monster_kill event for idle (AFK) combat that advances a kill daily', () => {
    const task = { type: 'combat', monster: { id: 'lesser_fiend', boss: false } }
    const sim = { xpGained: { combat: 900, hitpoints: 300 }, monstersKilled: 24 }
    const events = idleCatchupDailyEvents(task, sim)
    expect(events).toContainEqual({ kind: 'monster_kill', monsterId: 'lesser_fiend', count: 24 })
    // combat/hitpoints XP does not fire skill_xp (assigned via the reward modal).
    expect(events.some(e => e.kind === 'skill_xp' && e.skill === 'combat')).toBe(false)
  })

  it('emits boss_kill for a boss monster and forwards a completed slayer task', () => {
    const task = { type: 'combat', monster: { id: 'king_black_dragon', boss: true } }
    const sim = { monstersKilled: 2, slayerXpGained: 150, slayerTaskUpdate: { completed: true } }
    const events = idleCatchupDailyEvents(task, sim)
    expect(events).toContainEqual({ kind: 'boss_kill', monsterId: 'king_black_dragon', count: 2 })
    expect(events).toContainEqual({ kind: 'skill_xp', skill: 'slayer', xp: 150 })
    expect(events).toContainEqual({ kind: 'slayer_task_complete' })
  })

  it('emits skilling item events for idle skilling/gathering', () => {
    const skill = idleCatchupDailyEvents({ type: 'skill', skill: 'mining' }, { xpGained: { mining: 700 }, itemsGained: { iron_ore: 12 } })
    expect(skill).toContainEqual({ kind: 'skill_xp', skill: 'mining', xp: 700 })
    expect(skill).toContainEqual({ kind: 'skill_gather', skill: 'mining', itemId: 'iron_ore', count: 12 })
  })

  it('emits a hunter_hunt event for idle hunting', () => {
    const events = idleCatchupDailyEvents({ type: 'hunter', action: { id: 'hunt_cow' } }, { actions: 6 })
    expect(events).toContainEqual({ kind: 'hunter_hunt', actionId: 'hunt_cow', count: 6 })
  })

  it('emits nothing for quests, null tasks, or empty sims', () => {
    expect(idleCatchupDailyEvents({ type: 'quest' }, { xpGained: { attack: 500 } })).toEqual([])
    expect(idleCatchupDailyEvents(null, { xpGained: { mining: 1 } })).toEqual([])
    expect(idleCatchupDailyEvents({ type: 'agility', action: {} }, null)).toEqual([])
    expect(idleCatchupDailyEvents({ type: 'agility', action: {} }, { xpGained: { agility: 0 } })).toEqual([])
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
