// Heavy coverage for the boss/raid content gates extracted from
// CombatScreen.jsx. These determine whether a player can enter a fight or raid,
// so every branch (slayer level, quest gate, kill-count prereq, edge cases) is
// pinned here to guarantee the extraction preserved behaviour and stays correct.

import { describe, it, expect } from 'vitest'
import {
  checkBossRequirementsPure as checkBossRequirements,
  checkRaidRequirementsPure as checkRaidRequirements,
} from '../src/engine/combatRequirements.js'

const QUESTS = [
  { id: 'dragon_slayer', name: 'Dragon Slayer' },
  { id: 'a_night_at_the_theatre', name: 'A Night at the Theatre' },
]

function ctx(overrides: any = {}) {
  return {
    slayerLevel: 1,
    completedQuests: new Set<string>(),
    bossKillCounts: {} as Record<string, number>,
    questsData: QUESTS,
    ...overrides,
  }
}

describe('checkBossRequirements — slayer gate', () => {
  it('locks when slayer level is below the requirement', () => {
    const monster = { id: 'abyssal', name: 'Abyssal Fiend', slayerRequirement: 85 }
    const r = checkBossRequirements(monster, ctx({ slayerLevel: 84 }))
    expect(r.locked).toBe(true)
    expect(r.reason).toBe('Need Slayer level 85 to fight Abyssal Fiend')
  })

  it('unlocks exactly at the requirement', () => {
    const monster = { id: 'abyssal', name: 'Abyssal Fiend', slayerRequirement: 85 }
    expect(checkBossRequirements(monster, ctx({ slayerLevel: 85 })).locked).toBe(false)
    expect(checkBossRequirements(monster, ctx({ slayerLevel: 99 })).locked).toBe(false)
  })

  it('ignores slayer when the monster has no requirement', () => {
    const monster = { id: 'goblin', name: 'Goblin' }
    expect(checkBossRequirements(monster, ctx({ slayerLevel: 1 })).locked).toBe(false)
  })
})

describe('checkBossRequirements — quest gate', () => {
  const monster = { id: 'green_dragon', name: 'Green Dragon', questRequirement: 'dragon_slayer' }

  it('locks until the required quest is complete, using the quest display name', () => {
    const r = checkBossRequirements(monster, ctx())
    expect(r.locked).toBe(true)
    expect(r.reason).toBe('Complete Dragon Slayer to fight Green Dragon')
  })

  it('unlocks once the quest is complete', () => {
    const r = checkBossRequirements(monster, ctx({ completedQuests: new Set(['dragon_slayer']) }))
    expect(r.locked).toBe(false)
  })

  it('falls back to a humanized id when the quest is not in questsData', () => {
    const m = { id: 'x', name: 'X', questRequirement: 'lost_city_of_kings' }
    const r = checkBossRequirements(m, ctx({ questsData: [] }))
    expect(r.reason).toBe('Complete lost city of kings to fight X')
  })
})

describe('checkBossRequirements — kill-count prerequisite (Ashen Crucible)', () => {
  const monster = { id: 'ashen_crucible', name: 'Ashen Crucible' }

  it('locks with no Ember Tyrant kills', () => {
    expect(checkBossRequirements(monster, ctx()).locked).toBe(true)
    expect(checkBossRequirements(monster, ctx({ bossKillCounts: { ember_tyrant: 0 } })).locked).toBe(true)
  })

  it('unlocks after at least one Ember Tyrant kill', () => {
    expect(checkBossRequirements(monster, ctx({ bossKillCounts: { ember_tyrant: 1 } })).locked).toBe(false)
    expect(checkBossRequirements(monster, ctx({ bossKillCounts: { ember_tyrant: 50 } })).locked).toBe(false)
  })
})

describe('checkBossRequirements — gate ordering & edges', () => {
  it('reports the slayer gate before the quest gate when both fail', () => {
    const monster = {
      id: 'z', name: 'Z', slayerRequirement: 90, questRequirement: 'dragon_slayer',
    }
    const r = checkBossRequirements(monster, ctx({ slayerLevel: 1 }))
    expect(r.reason).toContain('Slayer level 90')
  })

  it('returns unlocked for a null monster and tolerates a missing context', () => {
    expect(checkBossRequirements(null as any, ctx()).locked).toBe(false)
    expect(checkBossRequirements({ id: 'goblin', name: 'Goblin' } as any).locked).toBe(false)
  })
})

describe('checkRaidRequirements', () => {
  it('locks Crimson Night Theatre until the quest is done', () => {
    const r = checkRaidRequirements({ id: 'theatre_of_blood' }, { completedQuests: new Set() })
    expect(r.locked).toBe(true)
    expect(r.reason).toContain('A Night at the Theatre')
  })

  it('unlocks the theatre once the quest is complete', () => {
    const r = checkRaidRequirements(
      { id: 'theatre_of_blood' },
      { completedQuests: new Set(['a_night_at_the_theatre']) },
    )
    expect(r.locked).toBe(false)
  })

  it('leaves other raids unlocked', () => {
    expect(checkRaidRequirements({ id: 'chambers_of_xeric' }, { completedQuests: new Set() }).locked).toBe(false)
  })

  it('returns unlocked for a null raid and tolerates a missing context', () => {
    expect(checkRaidRequirements(null as any, {}).locked).toBe(false)
    expect(checkRaidRequirements({ id: 'chambers_of_xeric' } as any).locked).toBe(false)
  })
})
