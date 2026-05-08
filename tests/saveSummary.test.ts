import { describe, it, expect } from 'vitest'
import {
  getTotalLevelFromSave,
  computeSaveSummary,
  computeSaveSummaryFromJson,
} from '../functions/_lib/saveSummary.js'
import { getXPForLevel } from '../src/engine/experience.js'

function statsAtLevels(levels: Record<string, number>) {
  const stats: Record<string, { xp: number, level: number }> = {}
  for (const [skill, lvl] of Object.entries(levels)) {
    stats[skill] = { xp: getXPForLevel(lvl), level: lvl }
  }
  return { stats }
}

describe('getTotalLevelFromSave', () => {
  it('returns 0 for empty / malformed saves', () => {
    expect(getTotalLevelFromSave(null as any)).toBe(0)
    expect(getTotalLevelFromSave(undefined as any)).toBe(0)
    expect(getTotalLevelFromSave({} as any)).toBe(0)
    expect(getTotalLevelFromSave({ stats: null } as any)).toBe(0)
    expect(getTotalLevelFromSave({ stats: 'oops' } as any)).toBe(0)
  })

  it('sums explicit .level fields across stats', () => {
    const save = statsAtLevels({ attack: 50, strength: 40, defence: 30, hitpoints: 35 })
    expect(getTotalLevelFromSave(save as any)).toBe(50 + 40 + 30 + 35)
  })

  it('derives missing levels from xp', () => {
    const save = {
      stats: {
        attack: { xp: getXPForLevel(60) },
        strength: { xp: getXPForLevel(70) },
      },
    }
    expect(getTotalLevelFromSave(save as any)).toBe(60 + 70)
  })

  it('skips invalid / negative entries', () => {
    const save = {
      stats: {
        attack: { level: 50 },
        strength: { level: -3 },
        defence: { xp: -100 },
        magic: 'nope',
        prayer: { level: 'NaN' },
      },
    }
    expect(getTotalLevelFromSave(save as any)).toBe(50)
  })

  it('handles a numeric (non-object) stat shape gracefully', () => {
    const save = { stats: { attack: 75, strength: 70 } }
    expect(getTotalLevelFromSave(save as any)).toBe(75 + 70)
  })
})

describe('computeSaveSummary', () => {
  it('returns total + combat level together', () => {
    const save = statsAtLevels({
      attack: 99, strength: 99, defence: 99, hitpoints: 99,
      ranged: 99, magic: 99, prayer: 99,
    })
    const summary = computeSaveSummary(save as any)
    expect(summary.totalLevel).toBe(99 * 7)
    expect(summary.combatLevel).toBe(126)
  })

  it('returns safe defaults for empty saves', () => {
    expect(computeSaveSummary(null as any)).toEqual({ totalLevel: 0, combatLevel: 3 })
    expect(computeSaveSummary({} as any)).toEqual({ totalLevel: 0, combatLevel: 3 })
  })
})

describe('computeSaveSummaryFromJson', () => {
  it('parses valid json', () => {
    const save = statsAtLevels({ attack: 60, strength: 60, defence: 1, hitpoints: 10 })
    const out = computeSaveSummaryFromJson(JSON.stringify(save))
    expect(out.totalLevel).toBe(60 + 60 + 1 + 10)
    expect(out.combatLevel).toBeGreaterThanOrEqual(3)
  })

  it('returns defaults for empty / null / invalid JSON without throwing', () => {
    expect(computeSaveSummaryFromJson('')).toEqual({ totalLevel: 0, combatLevel: 3 })
    expect(computeSaveSummaryFromJson(null as any)).toEqual({ totalLevel: 0, combatLevel: 3 })
    expect(computeSaveSummaryFromJson('{not json')).toEqual({ totalLevel: 0, combatLevel: 3 })
  })
})
