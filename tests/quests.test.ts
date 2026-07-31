// Quest engine — eligibility gating, quest-point tallies, tick progression and
// idle simulation. checkQuestEligibility is enforced on the server-side MCP
// start_quest/queue_quest path, and simulateIdleQuest drives offline progress,
// so both are correctness-critical.

import { describe, it, expect } from 'vitest'
import {
  getQuestPointsEarned,
  getCombatLevel,
  checkQuestEligibility,
  createQuestState,
  processQuestTick,
  simulateIdleQuest,
  formatQuestDuration,
  filterQuestsBySearch,
} from '../src/engine/quests.js'
import { getXPForLevel } from '../src/engine/experience.js'
import { TICK_DURATION } from '../src/utils/constants.js'

const QUESTS = [
  { id: 'novice_a', name: 'Novice A', complexity: 'Novice' },
  { id: 'exp_b', name: 'Experienced B', complexity: 'Experienced' },
  { id: 'gm_c', name: 'Grandmaster C', complexity: 'Grandmaster' },
  { id: 'unknown_complexity', name: 'Weird', complexity: 'Nonexistent' },
]

function statsAt(map: Record<string, number>) {
  const stats: Record<string, { xp: number }> = {}
  for (const [skill, lvl] of Object.entries(map)) stats[skill] = { xp: getXPForLevel(lvl) }
  return stats
}

describe('getQuestPointsEarned', () => {
  it('sums points by complexity tier, defaulting unknowns to 1', () => {
    const done = new Set(['novice_a', 'exp_b', 'gm_c', 'unknown_complexity'])
    // 1 + 2 + 5 + 1 (default) = 9
    expect(getQuestPointsEarned(done, QUESTS)).toBe(9)
  })

  it('ignores ids that are not real quests', () => {
    expect(getQuestPointsEarned(new Set(['ghost']), QUESTS)).toBe(0)
  })

  it('is zero for no completed quests', () => {
    expect(getQuestPointsEarned(new Set(), QUESTS)).toBe(0)
  })
})

describe('getCombatLevel', () => {
  it('floors to the minimum of 3 for a fresh account', () => {
    expect(getCombatLevel(statsAt({ attack: 1, strength: 1, defence: 1, hitpoints: 1 }))).toBe(3)
  })
})

describe('checkQuestEligibility', () => {
  const baseStats = statsAt({
    attack: 50, strength: 50, defence: 50, hitpoints: 50, ranged: 50, magic: 50, prayer: 43,
  })

  it('rejects an unknown quest', () => {
    const r = checkQuestEligibility(null as any, baseStats, new Set(), QUESTS)
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain('Unknown quest')
  })

  it('rejects an already-completed quest', () => {
    const quest = { id: 'novice_a', name: 'Novice A' }
    const r = checkQuestEligibility(quest, baseStats, new Set(['novice_a']), QUESTS)
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain('Already complete')
  })

  it('lists every unmet requirement (skill, prereq, QP, combat)', () => {
    const quest = {
      id: 'hard_quest',
      name: 'Hard Quest',
      skillRequirements: { attack: 70, mining: 60 },
      questRequirements: ['exp_b'],
      questPointRequirement: 20,
      combatLevelRequirement: 90,
    }
    const r = checkQuestEligibility(quest, baseStats, new Set(), QUESTS)
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain('Attack 70')
    expect(r.reasons).toContain('Mining 60')
    expect(r.reasons.some((x) => x.includes('Experienced B'))).toBe(true)
    expect(r.reasons.some((x) => x.startsWith('20 Quest points'))).toBe(true)
    expect(r.reasons.some((x) => x.startsWith('Combat level 90'))).toBe(true)
  })

  it('is eligible when every requirement is met', () => {
    const quest = {
      id: 'easy_quest',
      name: 'Easy Quest',
      skillRequirements: { attack: 40 },
      questRequirements: ['exp_b'],
      questPointRequirement: 2,
      combatLevelRequirement: 30,
    }
    const r = checkQuestEligibility(quest, baseStats, new Set(['exp_b']), QUESTS)
    expect(r).toEqual({ eligible: true, reasons: [] })
  })

  it('treats zero/absent requirements as satisfied', () => {
    const quest = { id: 'free_quest', name: 'Free', combatLevelRequirement: 0, questPointRequirement: 0 }
    const r = checkQuestEligibility(quest, baseStats, new Set(), QUESTS)
    expect(r.eligible).toBe(true)
  })
})

describe('processQuestTick', () => {
  it('decrements ticks and completes at zero', () => {
    let state = createQuestState({ id: 'q', durationSeconds: TICK_DURATION / 1000 * 2 })
    expect(state.totalTicks).toBe(2)

    let res = processQuestTick(state)
    expect(res.questState.ticksRemaining).toBe(1)
    expect(res.events).toHaveLength(0)
    expect(res.questState.active).toBe(true)

    res = processQuestTick(res.questState)
    expect(res.questState.ticksRemaining).toBe(0)
    expect(res.questState.active).toBe(false)
    expect(res.events).toEqual([{ type: 'questComplete', quest: state.quest }])
  })

  it('does not mutate the input state', () => {
    const state = createQuestState({ id: 'q', durationSeconds: 60 })
    const before = state.ticksRemaining
    processQuestTick(state)
    expect(state.ticksRemaining).toBe(before)
  })
})

describe('simulateIdleQuest', () => {
  const quest = {
    id: 'q',
    durationSeconds: 60,
    xpReward: { attack: 500 },
    coinReward: 1000,
    itemUnlocks: ['reward_item'],
  }

  it('returns null for non-quest or missing tasks', () => {
    expect(simulateIdleQuest(null as any, 10_000)).toBeNull()
    expect(simulateIdleQuest({ type: 'gather' } as any, 10_000)).toBeNull()
    expect(simulateIdleQuest({ type: 'quest' } as any, 10_000)).toBeNull()
  })

  it('does not complete or pay out below the full duration', () => {
    const task = createQuestState(quest)
    const r = simulateIdleQuest({ ...task, type: 'quest' }, TICK_DURATION) // one tick only
    expect(r!.completed).toBe(false)
    expect(r!.xpGained).toBeNull()
    expect(r!.coinsGained).toBe(0)
    expect(r!.itemUnlocks).toEqual([])
    expect(r!.ticksRemaining).toBe(task.totalTicks - 1)
  })

  it('completes and awards the full reward once enough time elapses', () => {
    const task = createQuestState(quest)
    const r = simulateIdleQuest({ ...task, type: 'quest' }, 10 * 60 * 1000) // plenty
    expect(r!.completed).toBe(true)
    expect(r!.ticksRemaining).toBe(0)
    expect(r!.xpGained).toEqual(quest.xpReward)
    expect(r!.coinsGained).toBe(quest.coinReward)
    expect(r!.itemUnlocks).toEqual(quest.itemUnlocks)
  })

  it('caps ticksUsed at the remaining work (no over-counting)', () => {
    const task = createQuestState(quest)
    const r = simulateIdleQuest({ ...task, type: 'quest' }, 10 * 60 * 1000)
    expect(r!.ticksUsed).toBe(task.totalTicks)
  })
})

describe('formatQuestDuration', () => {
  it('formats hours/minutes/seconds', () => {
    expect(formatQuestDuration(3600 + 15 * 60)).toBe('1h 15m')
    expect(formatQuestDuration(3600)).toBe('1h')
    expect(formatQuestDuration(45 * 60 + 30)).toBe('45m 30s')
    expect(formatQuestDuration(30 * 60)).toBe('30m')
    expect(formatQuestDuration(30)).toBe('30s')
  })
})

describe('filterQuestsBySearch', () => {
  it('returns the list untouched for a blank or whitespace query', () => {
    expect(filterQuestsBySearch(QUESTS, '')).toBe(QUESTS)
    expect(filterQuestsBySearch(QUESTS, '   ')).toBe(QUESTS)
    expect(filterQuestsBySearch(QUESTS, undefined)).toBe(QUESTS)
  })

  it('matches quest names case-insensitively on any substring', () => {
    expect(filterQuestsBySearch(QUESTS, 'NOVICE A').map(q => q.id)).toEqual(['novice_a'])
    expect(filterQuestsBySearch(QUESTS, 'ced b').map(q => q.id)).toEqual(['exp_b'])
  })

  it('matches the complexity tier so a player can search "grandmaster"', () => {
    expect(filterQuestsBySearch(QUESTS, 'grandmaster').map(q => q.id)).toEqual(['gm_c'])
  })

  it('trims surrounding whitespace before matching', () => {
    expect(filterQuestsBySearch(QUESTS, '  weird  ').map(q => q.id)).toEqual(['unknown_complexity'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterQuestsBySearch(QUESTS, 'dragon slayer')).toEqual([])
  })

  it('tolerates quests missing a name or complexity', () => {
    const ragged = [{ id: 'bare' }, { id: 'named', name: 'Bare Bones' }] as typeof QUESTS
    expect(filterQuestsBySearch(ragged, 'bare').map(q => q.id)).toEqual(['named'])
  })
})
