// The one operation that puts XP into a character's stats. The account type's
// cut lives here, downstream, because XP reaches a save from combat, skilling,
// quests, idle sims, the world, co-op rooms and MCP claims — cutting upstream
// in the combat engine would miss most of them and double-cut the rest.

import { describe, it, expect } from 'vitest'
import { bankXp } from '../src/engine/xpBank.js'

const stats = (overrides: Record<string, unknown> = {}) => ({
  attack: { skill: 'attack', xp: 0, level: 1 },
  ...overrides,
}) as any

describe('bankXp', () => {
  it('banks the full gain for an ordinary account and reports it', () => {
    const s = stats()
    expect(bankXp(s, 'attack', 1000)).toBe(1000)
    expect(s.attack.xp).toBe(1000)
  })

  it('halves the gain for a grindman and reports what it banked', () => {
    const s = stats()
    expect(bankXp(s, 'attack', 1000, { isGrindman: true })).toBe(500)
    expect(s.attack.xp).toBe(500)
  })

  it('banks nothing when the cut rounds the gain away', () => {
    const s = stats()
    expect(bankXp(s, 'attack', 1, { isGrindman: true })).toBe(0)
    expect(s.attack.xp).toBe(0)
  })

  it('raises the level with the XP', () => {
    const s = stats()
    bankXp(s, 'attack', 1000)
    expect(s.attack.level).toBe(9)
  })

  it('initialises a missing skill rather than dropping the gain', () => {
    // A server-created (MCP) save may not carry every skill entry yet, and
    // discarding the XP there means levels never rise.
    const s = stats()
    expect(bankXp(s, 'runecraft', 500)).toBe(500)
    expect(s.runecraft).toEqual({ skill: 'runecraft', xp: 500, level: 5 })
  })

  it('reports the XP that fit under the 200m cap, not the XP offered', () => {
    const s = stats({ attack: { skill: 'attack', xp: 199_999_000, level: 99 } })
    expect(bankXp(s, 'attack', 5000)).toBe(1000)
    expect(s.attack.xp).toBe(200_000_000)
  })

  it('ignores a gain that is absent, zero, negative or unusable', () => {
    const s = stats()
    for (const bad of [undefined, null, 0, -50, 'lots', NaN]) {
      expect(bankXp(s, 'attack', bad as never)).toBe(0)
    }
    expect(s.attack.xp).toBe(0)
  })

  it('does nothing without a stats object or a skill', () => {
    expect(bankXp(null as never, 'attack', 100)).toBe(0)
    expect(bankXp(stats(), '', 100)).toBe(0)
  })
})
