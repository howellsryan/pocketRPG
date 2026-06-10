// Guards the public surface of slayerRewards.js. If any of these helpers
// disappear, CombatScreen's monsterDeath handler throws before it can call
// setLootModal, and the loot modal silently stops appearing on kills.
// PR #380 regressed this once already by replacing the file wholesale.

import { describe, expect, it } from 'vitest'
import * as slayerRewards from '../src/engine/slayerRewards.js'
import {
  BOSS_SLAYER_TASK_XP_MULTIPLIER,
  DEFAULT_SLAYER_TASK_XP_MULTIPLIER,
  getBaseSlayerXp,
  getSlayerTaskReward,
  getSlayerTaskXpForKill,
  isBossMonster,
  resolveMonsterRewardData,
} from '../src/engine/slayerRewards.js'

const monstersData = {
  sanguine_veld: {
    id: 'sanguine_veld',
    name: 'Bloodveld',
    hitpoints: 120,
    slayerXP: 120,
  },
  deepmaw_kraken: {
    id: 'deepmaw_kraken',
    name: 'Deepmaw Kraken',
    hitpoints: 255,
    slayerXP: 255,
    boss: true,
  },
  boss_without_explicit_slayer_xp: {
    id: 'boss_without_explicit_slayer_xp',
    name: 'Boss Without Slayer XP',
    hitpoints: 80,
    boss: true,
  },
}

describe('slayerRewards module surface', () => {
  // CombatScreen.jsx imports each of these by name. If a refactor drops one,
  // the module load still succeeds (Vite resolves missing named imports to
  // undefined) and the failure only surfaces at runtime on monster death.
  // Lock the surface here so a missing export fails the build.
  it.each([
    ['resolveMonsterRewardData', 'function'],
    ['getSlayerTaskXpForKill', 'function'],
    ['getBaseSlayerXp', 'function'],
    ['isBossMonster', 'function'],
    ['getSlayerTaskReward', 'function'],
    ['DEFAULT_SLAYER_TASK_XP_MULTIPLIER', 'number'],
    ['BOSS_SLAYER_TASK_XP_MULTIPLIER', 'number'],
  ])('exports %s as a %s', (name, expectedType) => {
    expect(typeof (slayerRewards as any)[name]).toBe(expectedType)
  })
})

describe('resolveMonsterRewardData', () => {
  it('returns the full monster record from monstersData when only id/name/boss are passed', () => {
    expect(resolveMonsterRewardData({ id: 'deepmaw_kraken', name: 'Deepmaw Kraken', boss: true }, null, monstersData))
      .toBe(monstersData.deepmaw_kraken)
  })

  it('falls back to the live state.monster when defeatedMonster is null', () => {
    const liveMonster = { id: 'unknown_id', name: 'Mystery', hitpoints: 50 }
    expect(resolveMonsterRewardData(null, liveMonster, {}))
      .toBe(liveMonster)
  })

  it('prefers the live state.monster from monstersData when defeatedMonster.id is unknown', () => {
    const liveMonster = { id: 'deepmaw_kraken' }
    expect(resolveMonsterRewardData({ id: 'unknown_id' }, liveMonster, monstersData))
      .toBe(monstersData.deepmaw_kraken)
  })

  it('returns the defeated monster object as a last resort', () => {
    const defeated = { id: 'orphan', name: 'Orphan' }
    expect(resolveMonsterRewardData(defeated, null, {})).toBe(defeated)
  })
})

describe('getBaseSlayerXp', () => {
  it('uses explicit slayerXP before hitpoints', () => {
    expect(getBaseSlayerXp({ id: 'sanguine_veld' }, null, monstersData)).toBe(120)
  })

  it('falls back to hitpoints when slayerXP is absent', () => {
    expect(getBaseSlayerXp({ id: 'boss_without_explicit_slayer_xp' }, null, monstersData)).toBe(80)
  })

  it('returns 0 when no monster data is available', () => {
    expect(getBaseSlayerXp({ id: 'nope' }, null, {})).toBe(0)
  })
})

describe('isBossMonster', () => {
  it('detects bosses via the resolved monstersData record', () => {
    expect(isBossMonster({ id: 'deepmaw_kraken', name: 'Deepmaw Kraken', boss: true }, null, monstersData)).toBe(true)
  })

  it('returns false for non-boss monsters', () => {
    expect(isBossMonster({ id: 'sanguine_veld' }, null, monstersData)).toBe(false)
  })
})

describe('getSlayerTaskXpForKill', () => {
  it('awards 2x base Slayer XP for non-boss task kills', () => {
    expect(getSlayerTaskXpForKill({ id: 'sanguine_veld' }, null, monstersData))
      .toBe(120 * DEFAULT_SLAYER_TASK_XP_MULTIPLIER)
  })

  it('awards 10x base Slayer XP for boss task kills', () => {
    expect(getSlayerTaskXpForKill({ id: 'deepmaw_kraken', name: 'Deepmaw Kraken', boss: true }, null, monstersData))
      .toBe(255 * BOSS_SLAYER_TASK_XP_MULTIPLIER)
  })

  it('falls back to hitpoints for boss task XP when slayerXP is missing', () => {
    expect(getSlayerTaskXpForKill({ id: 'boss_without_explicit_slayer_xp', boss: true }, null, monstersData))
      .toBe(80 * BOSS_SLAYER_TASK_XP_MULTIPLIER)
  })

  it('doubles XP when doubleXp option is set for a non-boss', () => {
    expect(getSlayerTaskXpForKill({ id: 'sanguine_veld' }, null, monstersData, { doubleXp: true }))
      .toBe(Math.floor(120 * DEFAULT_SLAYER_TASK_XP_MULTIPLIER * 2))
  })

  it('doubles XP when doubleXp option is set for a boss (stacks with ×10)', () => {
    expect(getSlayerTaskXpForKill({ id: 'deepmaw_kraken', name: 'Deepmaw Kraken', boss: true }, null, monstersData, { doubleXp: true }))
      .toBe(Math.floor(255 * BOSS_SLAYER_TASK_XP_MULTIPLIER * 2))
  })

  it('does not double XP when doubleXp is false', () => {
    expect(getSlayerTaskXpForKill({ id: 'sanguine_veld' }, null, monstersData, { doubleXp: false }))
      .toBe(120 * DEFAULT_SLAYER_TASK_XP_MULTIPLIER)
  })
})

describe('getSlayerTaskReward', () => {
  it('awards base points on normal tasks', () => {
    expect(getSlayerTaskReward(10, 0)).toEqual({ totalTasks: 1, multiplier: 1, pointsEarned: 10 })
  })

  it('awards 10x points every 5th task', () => {
    expect(getSlayerTaskReward(12, 4)).toEqual({ totalTasks: 5, multiplier: 10, pointsEarned: 120 })
  })

  it('awards 50x points every 50th task', () => {
    expect(getSlayerTaskReward(7, 49)).toEqual({ totalTasks: 50, multiplier: 50, pointsEarned: 350 })
  })
})
