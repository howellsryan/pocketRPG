// Pins the single-source-of-truth combat-level module and proves the client
// helper, the quest-engine helper, and the server helper all agree — the
// divergence (client omitted the Math.max(3,…) floor) that this consolidates.

import { describe, it, expect } from 'vitest'
import { combatLevelFromLevels, combatLevelFromStats } from '../src/engine/combatLevel.js'
import { calcCombatLevel } from '../src/utils/helpers.js'
import { getCombatLevel } from '../src/engine/quests.js'
import { getCombatLevelFromSave } from '../functions/_lib/combatLevel.js'
import { getXPForLevel } from '../src/engine/experience.js'

function levels(map: Record<string, number>) {
  const out: Record<string, number> = {
    attack: 1, strength: 1, defence: 1, hitpoints: 10,
    ranged: 1, magic: 1, prayer: 1,
  }
  return { ...out, ...map }
}

function statsFromLevels(map: Record<string, number>): { stats: Record<string, { xp: number }> } {
  const lv = levels(map)
  const stats: Record<string, { xp: number }> = {}
  for (const [skill, l] of Object.entries(lv)) stats[skill] = { xp: getXPForLevel(l) }
  return { stats }
}

describe('combatLevel shared module', () => {
  it('floors a fresh all-level-1 (hp 10) account to the minimum of 3', () => {
    expect(combatLevelFromLevels(levels({ hitpoints: 1 }))).toBe(3)
    expect(combatLevelFromStats(statsFromLevels({ hitpoints: 1 }).stats)).toBe(3)
  })

  it('computes 126 for a maxed melee/range/mage account', () => {
    const maxed = {
      attack: 99, strength: 99, defence: 99, hitpoints: 99,
      ranged: 99, magic: 99, prayer: 99,
    }
    expect(combatLevelFromLevels(maxed)).toBe(126)
  })

  it('takes the highest of melee / ranged / magic styles', () => {
    const ranger = combatLevelFromLevels(levels({ ranged: 99, hitpoints: 99, defence: 70 }))
    const mage = combatLevelFromLevels(levels({ magic: 99, hitpoints: 99, defence: 70 }))
    expect(ranger).toBe(mage) // ranged & magic contributions are symmetric
    expect(ranger).toBeGreaterThan(combatLevelFromLevels(levels({ hitpoints: 99, defence: 70 })))
  })

  it('client, quest-engine, and server helpers return identical values', () => {
    const matrix = [
      { hitpoints: 1 },
      { attack: 40, strength: 40, defence: 40, hitpoints: 40 },
      { ranged: 80, defence: 60, hitpoints: 70 },
      { magic: 94, defence: 75, hitpoints: 80, prayer: 52 },
      { attack: 99, strength: 99, defence: 99, hitpoints: 99, ranged: 99, magic: 99, prayer: 99 },
    ]
    for (const m of matrix) {
      const lv = levels(m)
      const save = statsFromLevels(m)
      const expected = combatLevelFromLevels(lv)
      expect(calcCombatLevel(lv)).toBe(expected)
      expect(getCombatLevel(save.stats)).toBe(expected)
      expect(getCombatLevelFromSave(save)).toBe(expected)
      expect(expected).toBeGreaterThanOrEqual(3)
    }
  })

  it('handles missing/garbage stats without throwing', () => {
    expect(combatLevelFromLevels(undefined as any)).toBe(3)
    expect(combatLevelFromLevels({} as any)).toBe(3)
    expect(combatLevelFromStats(undefined as any)).toBe(3)
    expect(getCombatLevelFromSave(null as any)).toBe(3)
  })
})
