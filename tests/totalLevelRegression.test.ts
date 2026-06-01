import { describe, it, expect } from 'vitest'
import { detectTotalLevelRegression } from '../functions/_lib/game/saveValidation.js'
import { getXPForLevel } from '../src/engine/experience.js'

function saveAtLevels(levels: Record<string, number>) {
  const stats: Record<string, { xp: number; level: number }> = {}
  for (const [skill, lvl] of Object.entries(levels)) {
    stats[skill] = { xp: getXPForLevel(lvl), level: lvl }
  }
  return { stats }
}

// A brand-new character: every skill level 1, hitpoints level 10 — the
// "level 3" combat fresh-start state that was wiping live accounts.
const FRESH_SAVE = saveAtLevels({
  attack: 1, strength: 1, defence: 1, hitpoints: 10, ranged: 1, magic: 1, prayer: 1,
})

describe('detectTotalLevelRegression', () => {
  it('rejects a fresh / level-3 character written over a levelled save', () => {
    const previous = saveAtLevels({ attack: 80, strength: 75, defence: 70, hitpoints: 78, magic: 60 })
    const result = detectTotalLevelRegression(previous, FRESH_SAVE)
    expect(result.regressed).toBe(true)
    expect(result.nextTotalLevel).toBeLessThan(result.previousTotalLevel)
  })

  it('rejects a null/empty wipe over a levelled save', () => {
    const previous = saveAtLevels({ attack: 50, strength: 40, defence: 30, hitpoints: 35 })
    expect(detectTotalLevelRegression(previous, {}).regressed).toBe(true)
    expect(detectTotalLevelRegression(previous, null as any).regressed).toBe(true)
  })

  it('rejects any decrease, even a single level', () => {
    const previous = saveAtLevels({ attack: 50, strength: 50 })
    const next = saveAtLevels({ attack: 50, strength: 49 })
    expect(detectTotalLevelRegression(previous, next).regressed).toBe(true)
  })

  it('allows progress (total level increases)', () => {
    const previous = saveAtLevels({ attack: 50, strength: 50, defence: 50 })
    const next = saveAtLevels({ attack: 60, strength: 50, defence: 50 })
    const result = detectTotalLevelRegression(previous, next)
    expect(result.regressed).toBe(false)
    expect(result.nextTotalLevel).toBeGreaterThan(result.previousTotalLevel)
  })

  it('allows an unchanged total level (inventory-only / sidegrade saves)', () => {
    const previous = saveAtLevels({ attack: 50, strength: 50, defence: 50 })
    const next = saveAtLevels({ attack: 50, strength: 50, defence: 50 })
    expect(detectTotalLevelRegression(previous, next).regressed).toBe(false)
  })

  it('allows the genuine first save (no previous save exists)', () => {
    // Empty previous → total level 0, so a fresh character is not a regression.
    expect(detectTotalLevelRegression({}, FRESH_SAVE).regressed).toBe(false)
    expect(detectTotalLevelRegression(null as any, FRESH_SAVE).regressed).toBe(false)
  })
})
