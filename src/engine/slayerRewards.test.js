import { describe, expect, it } from 'vitest'
import {
  BOSS_SLAYER_TASK_XP_MULTIPLIER,
  DEFAULT_SLAYER_TASK_XP_MULTIPLIER,
  getBaseSlayerXp,
  getSlayerTaskXpForKill,
  isBossMonster,
  resolveMonsterRewardData,
} from './slayerRewards.js'

describe('slayerRewards', () => {
  const monstersData = {
    blood_veld: {
      id: 'blood_veld',
      name: 'Bloodveld',
      hitpoints: 120,
      slayerXP: 120,
    },
    kraken: {
      id: 'kraken',
      name: 'Kraken',
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

  it('resolves full monster reward data from monstersData when the death event only has id/name/boss', () => {
    expect(resolveMonsterRewardData({ id: 'kraken', name: 'Kraken', boss: true }, null, monstersData)).toBe(monstersData.kraken)
  })

  it('uses explicit slayerXP before hitpoints', () => {
    expect(getBaseSlayerXp({ id: 'blood_veld' }, null, monstersData)).toBe(120)
  })

  it('awards the existing 2x Slayer XP for non-boss task kills', () => {
    expect(getSlayerTaskXpForKill({ id: 'blood_veld' }, null, monstersData)).toBe(120 * DEFAULT_SLAYER_TASK_XP_MULTIPLIER)
  })

  it('awards 10x Slayer XP for boss task kills', () => {
    expect(isBossMonster({ id: 'kraken', name: 'Kraken', boss: true }, null, monstersData)).toBe(true)
    expect(getSlayerTaskXpForKill({ id: 'kraken', name: 'Kraken', boss: true }, null, monstersData)).toBe(255 * BOSS_SLAYER_TASK_XP_MULTIPLIER)
  })

  it('falls back to hitpoints for boss task XP when slayerXP is not present', () => {
    expect(getSlayerTaskXpForKill({ id: 'boss_without_explicit_slayer_xp', boss: true }, null, monstersData)).toBe(80 * BOSS_SLAYER_TASK_XP_MULTIPLIER)
  })
})
