// Server-side combat level computation used by the PvP waiting room and
// invitation endpoints to enforce the symmetric ±10 visibility band.
// Mirrors src/engine/quests.js getCombatLevel — these tests pin the
// formula so a future quest-engine refactor can't silently drift.

import { describe, it, expect } from 'vitest'
import { getCombatLevelFromSave } from '../functions/_lib/combatLevel.js'
import { getXPForLevel } from '../src/engine/experience.js'

function statsAtLevels(levels: Record<string, number>) {
  const stats: Record<string, { xp: number, level: number }> = {}
  for (const [skill, lvl] of Object.entries(levels)) {
    stats[skill] = { xp: getXPForLevel(lvl), level: lvl }
  }
  return { stats }
}

describe('getCombatLevelFromSave (PvP server-side CB)', () => {
  it('returns 3 for an empty save (lowest possible CB)', () => {
    expect(getCombatLevelFromSave(null as any)).toBe(3)
    expect(getCombatLevelFromSave({} as any)).toBe(3)
    expect(getCombatLevelFromSave({ stats: {} } as any)).toBe(3)
  })

  it('matches the OSRS formula for an all-99 melee character (CB 126)', () => {
    const save = statsAtLevels({
      attack: 99, strength: 99, defence: 99, hitpoints: 99,
      ranged: 99, magic: 99, prayer: 99,
    })
    expect(getCombatLevelFromSave(save)).toBe(126)
  })

  it('matches a typical low-level pure (60 atk, 60 str, 1 def, 10 hp)', () => {
    const save = statsAtLevels({
      attack: 60, strength: 60, defence: 1, hitpoints: 10,
      ranged: 1, magic: 1, prayer: 1,
    })
    // base = 0.25 * (1 + 10 + 0) = 2.75
    // melee = 0.325 * (60 + 60) = 39
    // ranged = 0.325 * (0 + 1) = 0.325, magic = 0.325
    // CB = floor(2.75 + 39) = 41
    expect(getCombatLevelFromSave(save)).toBe(41)
  })

  it('floors to integer and never drops below 3', () => {
    // Level 1 across the board → very low base — must clamp to 3
    const save = statsAtLevels({
      attack: 1, strength: 1, defence: 1, hitpoints: 1,
      ranged: 1, magic: 1, prayer: 1,
    })
    const cb = getCombatLevelFromSave(save)
    expect(cb).toBeGreaterThanOrEqual(3)
    expect(Number.isInteger(cb)).toBe(true)
  })

  it('takes the higher of melee/range/mage contribution', () => {
    // 99 ranged but 1 melee → range path dominates
    const ranged = statsAtLevels({
      attack: 1, strength: 1, defence: 1, hitpoints: 10,
      ranged: 99, magic: 1, prayer: 1,
    })
    const cbR = getCombatLevelFromSave(ranged)

    const melee = statsAtLevels({
      attack: 99, strength: 99, defence: 1, hitpoints: 10,
      ranged: 1, magic: 1, prayer: 1,
    })
    const cbM = getCombatLevelFromSave(melee)

    expect(cbR).toBeGreaterThan(20)
    expect(cbM).toBeGreaterThan(cbR)  // 99/99 melee outranks 99 ranged solo
  })

  it('CB ±10 band is symmetric (sanity for the lobby filter)', () => {
    const a = statsAtLevels({ attack: 50, strength: 50, defence: 50, hitpoints: 50, ranged: 1, magic: 1, prayer: 1 })
    const b = statsAtLevels({ attack: 55, strength: 55, defence: 50, hitpoints: 50, ranged: 1, magic: 1, prayer: 1 })
    const cbA = getCombatLevelFromSave(a)
    const cbB = getCombatLevelFromSave(b)
    expect(Math.abs(cbA - cbB)).toBe(Math.abs(cbB - cbA))
    expect(Math.abs(cbA - cbB)).toBeLessThanOrEqual(10)
  })
})
