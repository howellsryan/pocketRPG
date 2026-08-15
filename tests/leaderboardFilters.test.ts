import { describe, it, expect } from 'vitest'
import {
  getLeaderboardFilters,
  getLeaderboardFilterById,
  isValidKcSource,
  TOTAL_LEVEL_FILTER,
  IRONMAN_FILTER,
  GRINDMAN_FILTER,
} from '../src/engine/leaderboardFilters.js'
import raidsData from '../src/data/raids.json'
import monstersData from '../src/data/monsters.json'

describe('leaderboard filters (shared client/server)', () => {
  it('puts total level first, then ironman, then grindman, then raids, then bosses', () => {
    const filters = getLeaderboardFilters()
    expect(filters[0]).toEqual(TOTAL_LEVEL_FILTER)
    expect(filters[1]).toEqual(IRONMAN_FILTER)
    expect(filters[2]).toEqual(GRINDMAN_FILTER)

    const firstKcIdx = filters.findIndex(f => f.type === 'kc')
    const lastRaidIdx = filters.map(f => f.sourceType).lastIndexOf('raids')
    const firstBossIdx = filters.findIndex(f => f.sourceType === 'monsters')
    expect(firstKcIdx).toBe(3)
    expect(lastRaidIdx).toBeLessThan(firstBossIdx)
  })

  it('exposes an ironman filter resolvable by id, excluded from KC sources', () => {
    expect(getLeaderboardFilterById('ironman')).toEqual(IRONMAN_FILTER)
    expect(IRONMAN_FILTER.type).toBe('ironman')
    expect(isValidKcSource('ironman', 'ironman')).toBe(false)
  })

  it('exposes a grindman filter resolvable by id, excluded from KC sources', () => {
    expect(getLeaderboardFilterById('grindman')).toEqual(GRINDMAN_FILTER)
    expect(GRINDMAN_FILTER.type).toBe('grindman')
    expect(isValidKcSource('grindman', 'grindman')).toBe(false)
  })

  it('includes only canonical raids (legacy aliases excluded)', () => {
    const raidFilters = getLeaderboardFilters().filter(f => f.sourceType === 'raids')
    const canonicalCount = Object.entries(raidsData).filter(([key, r]: any) => r.id === key).length
    expect(raidFilters.length).toBe(canonicalCount)
    // chambers_of_xeric is a legacy alias of vaults_of_xyren — must not appear.
    expect(raidFilters.some(f => f.sourceId === 'chambers_of_xeric')).toBe(false)
    expect(raidFilters.some(f => f.sourceId === 'vaults_of_xyren')).toBe(true)
  })

  it('lists standalone bosses ordered by combat level ascending, excluding raid sub-bosses', () => {
    const bossFilters = getLeaderboardFilters().filter(f => f.sourceType === 'monsters')
    const raidBossIds = new Set<string>()
    for (const raid of Object.values(raidsData) as any[]) {
      for (const bossId of (raid.bosses || [])) raidBossIds.add(bossId)
    }
    const standaloneCount = Object.entries(monstersData)
      .filter(([key, m]: any) => m.boss === true && !raidBossIds.has(key)).length
    expect(bossFilters.length).toBe(standaloneCount)
    // kaelor_the_tainted is a Cryptbound Champions sub-boss — must not appear.
    expect(bossFilters.some(f => f.sourceId === 'kaelor_the_tainted')).toBe(false)
    // No boss filter may be a raid sub-boss.
    expect(bossFilters.every(f => !raidBossIds.has(f.sourceId))).toBe(true)
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
