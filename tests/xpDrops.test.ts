// Combat XP drops: the mapping from a tick's combat events to the floating
// "+X skill XP" numbers. In a co-op fight this is also what tells you which
// hits were yours, so the characterId filter is load-bearing, not cosmetic.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { xpDropsFromCombatEvents, emitXpDrops } from '../src/utils/xpDrops.js'

afterEach(() => { vi.restoreAllMocks() })

describe('xpDropsFromCombatEvents', () => {
  it('aggregates a tick into one drop per skill', () => {
    const drops = xpDropsFromCombatEvents([
      { type: 'xp', xpSkills: { attack: 16, hitpoints: 5 } },
      { type: 'xp', xpSkills: { attack: 8 } },
    ])
    expect(drops).toEqual([{ skill: 'attack', amount: 24 }, { skill: 'hitpoints', amount: 5 }])
  })

  it('keeps only the viewer\'s own XP when a character id is given', () => {
    const events = [
      { type: 'xp', characterId: 1, xpSkills: { attack: 10 } },
      { type: 'xp', characterId: 2, xpSkills: { attack: 999 } },
    ]
    expect(xpDropsFromCombatEvents(events, 1)).toEqual([{ skill: 'attack', amount: 10 }])
    expect(xpDropsFromCombatEvents(events, 2)).toEqual([{ skill: 'attack', amount: 999 }])
    expect(xpDropsFromCombatEvents(events, 3)).toEqual([])
  })

  it('matches character ids across string and number forms', () => {
    expect(xpDropsFromCombatEvents([{ type: 'xp', characterId: '4', xpSkills: { magic: 7 } }], 4))
      .toEqual([{ skill: 'magic', amount: 7 }])
  })

  it('takes every event when no character id is given, as solo combat does', () => {
    const drops = xpDropsFromCombatEvents([{ type: 'xp', characterId: 9, xpSkills: { strength: 4 } }])
    expect(drops).toEqual([{ skill: 'strength', amount: 4 }])
  })

  it('drops zero, negative and non-numeric gains rather than showing "+0"', () => {
    expect(xpDropsFromCombatEvents([
      { type: 'xp', xpSkills: { attack: 0, defence: -5, magic: null, ranged: 'lots' } },
    ])).toEqual([])
  })

  it('floors fractional XP so the drop matches what was banked', () => {
    expect(xpDropsFromCombatEvents([{ type: 'xp', xpSkills: { hitpoints: 5.33 } }]))
      .toEqual([{ skill: 'hitpoints', amount: 5 }])
  })

  it('ignores events that are not XP grants', () => {
    expect(xpDropsFromCombatEvents([
      { type: 'playerHit', damage: 20 },
      { type: 'xp' },
      { type: 'xp', xpSkills: null },
      null,
      undefined,
    ])).toEqual([])
  })

  it('handles no events at all', () => {
    expect(xpDropsFromCombatEvents([])).toEqual([])
    expect(xpDropsFromCombatEvents(null)).toEqual([])
  })
})

describe('emitXpDrops', () => {
  // Node test environment: no DOM, so stand in for the browser globals the
  // overlay listens on.
  function stubWindow() {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    if (typeof globalThis.CustomEvent === 'undefined') {
      vi.stubGlobal('CustomEvent', class { type: string; detail: unknown
        constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail } })
    }
    return dispatchEvent
  }

  afterEach(() => { vi.unstubAllGlobals() })

  it('dispatches one xp-gain event per drop', () => {
    const dispatch = stubWindow()
    emitXpDrops([{ skill: 'attack', amount: 24 }, { skill: 'hitpoints', amount: 8 }])
    expect(dispatch).toHaveBeenCalledTimes(2)
    const events = dispatch.mock.calls.map((c) => c[0] as CustomEvent)
    expect(events.map((e) => e.type)).toEqual(['pocketrpg:xp-gain', 'pocketrpg:xp-gain'])
    expect(events.map((e) => e.detail)).toEqual([
      { skill: 'attack', amount: 24 },
      { skill: 'hitpoints', amount: 8 },
    ])
  })

  it('stays quiet when there is nothing to show', () => {
    const dispatch = stubWindow()
    emitXpDrops([])
    emitXpDrops(null)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not throw when there is no window at all (SSR/tests)', () => {
    vi.stubGlobal('window', undefined)
    expect(() => emitXpDrops([{ skill: 'attack', amount: 1 }])).not.toThrow()
  })
})
