import { describe, it, expect } from 'vitest'
import {
  getLeaderboardFilters,
  getLeaderboardFilterById,
  isValidKcSource,
  TOTAL_LEVEL_FILTER,
} from '../src/engine/leaderboardFilters.js'
import raidsData from '../src/data/raids.json'
import monstersData from '../src/data/monsters.json'

describe('leaderboard filters (shared client/server)', () => {
  it('puts total level first, then raids, then bosses', () => {
    const filters = getLeaderboardFilters()
    expect(filters[0]).toEqual(TOTAL_LEVEL_FILTER)

    const firstKcIdx = filters.findIndex(f => f.type === 'kc')
    const lastRaidIdx = filters.map(f => f.sourceType).lastIndexOf('raids')
    const firstBossIdx = filters.findIndex(f => f.sourceType === 'monsters')
    expect(firstKcIdx).toBe(1)
    expect(lastRaidIdx).toBeLessThan(firstBossIdx)
  })

  it('includes only canonical raids (legacy aliases excluded)', () => {
    const raidFilters = getLeaderboardFilters().filter(f => f.sourceType === 'raids')
    const canonicalCount = Object.entries(raidsData).filter(([key, r]: any) => r.id === key).length
    expect(raidFilters.length).toBe(canonicalCount)
    // chambers_of_xeric is a legacy alias of vaults_of_xyren — must not appear.
    expect(raidFilters.some(f => f.sourceId === 'chambers_of_xeric')).toBe(false)
    expect(raidFilters.some(f => f.sourceId === 'vaults_of_xyren')).toBe(true)
  })

  it('lists every boss ordered by combat level ascending', () => {
    const bossFilters = getLeaderboardFilters().filter(f => f.sourceType === 'monsters')
    const bossCount = Object.values(monstersData).filter((m: any) => m.boss === true).length
    expect(bossFilters.length).toBe(bossCount)
    for (let i = 1; i < bossFilters.length; i++) {
      expect(bossFilters[i].combatLevel).toBeGreaterThanOrEqual(bossFilters[i - 1].combatLevel)
    }
  })

  it('validates KC sources, rejecting legacy aliases and unknowns', () => {
    expect(isValidKcSource('raids', 'vaults_of_xyren')).toBe(true)
    expect(isValidKcSource('monsters', 'deepmaw_kraken')).toBe(true)
    expect(isValidKcSource('raids', 'chambers_of_xeric')).toBe(false)
    expect(isValidKcSource('monsters', 'not_a_boss')).toBe(false)
    expect(isValidKcSource('total', 'total')).toBe(false)
  })

  it('resolves filters by id', () => {
    expect(getLeaderboardFilterById('total')).toEqual(TOTAL_LEVEL_FILTER)
    expect(getLeaderboardFilterById('raids:vaults_of_xyren')?.sourceId).toBe('vaults_of_xyren')
    expect(getLeaderboardFilterById('nope')).toBe(null)
  })
})
