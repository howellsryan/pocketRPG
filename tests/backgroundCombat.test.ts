// backgroundCombat.js decides whether an active fight may keep ticking while the
// player is on another screen. Getting this wrong either strands progress
// (eligible fight treated as flee) or — worse — lets a boss/raid run unattended,
// the exact "die without realising" risk the setting guards. Pin every branch.

import { describe, it, expect } from 'vitest'
import { isBackgroundCombatEligible, monsterHpFraction } from '../src/engine/backgroundCombat.js'

const normalFight = { type: 'combat', monster: { id: 'rat', name: 'Rat' } }

describe('isBackgroundCombatEligible', () => {
  it('is false when the setting is off, even for a normal monster', () => {
    expect(isBackgroundCombatEligible({ task: normalFight, enabled: false })).toBe(false)
  })

  it('is true for a standard monster fight when enabled', () => {
    expect(isBackgroundCombatEligible({ task: normalFight, enabled: true })).toBe(true)
  })

  it('is false for a non-combat task', () => {
    expect(isBackgroundCombatEligible({ task: { type: 'skill', skill: 'fishing' }, enabled: true })).toBe(false)
  })

  it('is false when there is no task', () => {
    expect(isBackgroundCombatEligible({ task: null, enabled: true })).toBe(false)
    expect(isBackgroundCombatEligible({ enabled: true })).toBe(false)
  })

  it('never backgrounds a boss fight', () => {
    const boss = { type: 'combat', monster: { id: 'kbd', name: 'King Black Dragon', boss: true } }
    expect(isBackgroundCombatEligible({ task: boss, enabled: true })).toBe(false)
  })

  it('never backgrounds a raid', () => {
    expect(isBackgroundCombatEligible({ task: { type: 'combat', monster: { id: 'b' }, raid: true }, enabled: true })).toBe(false)
    expect(isBackgroundCombatEligible({ task: { type: 'combat', monster: { id: 'b' }, raidId: 'chambers' }, enabled: true })).toBe(false)
  })

  it('never backgrounds a dungeon fight', () => {
    const dungeonFight = { type: 'combat', monster: { id: 'rat', name: 'Rat' }, dungeon: true }
    expect(isBackgroundCombatEligible({ task: dungeonFight, enabled: true })).toBe(false)
  })

  it('defaults enabled to falsey when omitted', () => {
    expect(isBackgroundCombatEligible({ task: normalFight })).toBe(false)
  })
})

describe('monsterHpFraction', () => {
  it('is directly proportional to HP left — 50 of 100 → 0.5', () => {
    expect(monsterHpFraction(50, 100)).toBe(0.5)
  })

  it('is full at max HP and empty at 0', () => {
    expect(monsterHpFraction(100, 100)).toBe(1)
    expect(monsterHpFraction(0, 100)).toBe(0)
  })

  it('tracks partial HP linearly', () => {
    expect(monsterHpFraction(10, 100)).toBeCloseTo(0.1)
    expect(monsterHpFraction(75, 300)).toBe(0.25)
  })

  it('clamps out-of-range HP into 0..1', () => {
    expect(monsterHpFraction(150, 100)).toBe(1)
    expect(monsterHpFraction(-5, 100)).toBe(0)
  })

  it('returns null when the values are unusable (so the ring hides)', () => {
    expect(monsterHpFraction(50, 0)).toBe(null)
    expect(monsterHpFraction(null, 100)).toBe(null)
    expect(monsterHpFraction(undefined, undefined)).toBe(null)
  })
})
