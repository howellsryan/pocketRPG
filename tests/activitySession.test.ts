// The per-session tally helpers shared by every idle activity screen and the
// App-level background runner. ratePerHour guards a divide-by-elapsed, and
// sessionPatchFromResult routes idle-sim output into the right counters.

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  emptySession,
  mergeSession,
  ratePerHour,
  sessionPatchFromResult,
} from '../src/engine/activitySession.js'

afterEach(() => vi.useRealTimers())

describe('emptySession / mergeSession', () => {
  it('starts every counter at zero', () => {
    const s = emptySession(1000)
    expect(s).toEqual({ startedAt: 1000, actions: 0, xp: 0, coins: 0, items: 0, seeds: 0, tokens: 0 })
  })

  it('accumulates each field additively and preserves startedAt', () => {
    const base = emptySession(500)
    const a = mergeSession(base, { actions: 2, xp: 50, coins: 10 })
    const b = mergeSession(a, { actions: 3, items: 4, seeds: 1, tokens: 7 })
    expect(b).toEqual({ startedAt: 500, actions: 5, xp: 50, coins: 10, items: 4, seeds: 1, tokens: 7 })
  })

  it('tolerates a null base and an empty patch', () => {
    const s = mergeSession(null as any)
    expect(s.actions).toBe(0)
    expect(typeof s.startedAt).toBe('number')
  })
})

describe('ratePerHour', () => {
  it('returns null until there is a usable sample', () => {
    expect(ratePerHour(0, Date.now())).toBeNull()
    expect(ratePerHour(100, 0 as any)).toBeNull()
  })

  it('returns null within the 5s warm-up guard', () => {
    vi.useFakeTimers()
    const start = Date.now()
    vi.setSystemTime(start + 4000)
    expect(ratePerHour(100, start)).toBeNull()
  })

  it('extrapolates a whole-number hourly rate after the guard', () => {
    vi.useFakeTimers()
    const start = Date.now()
    vi.setSystemTime(start + 6000) // 6s elapsed
    // 100 actions in 6s → 60,000/hr
    expect(ratePerHour(100, start)).toBe(60000)
  })
})

describe('sessionPatchFromResult', () => {
  it('returns an empty patch for no result', () => {
    expect(sessionPatchFromResult({ type: 'skill' } as any, null)).toEqual({})
  })

  it('routes skill XP by the task skill key', () => {
    const patch = sessionPatchFromResult(
      { type: 'skill', skill: 'cooking' } as any,
      { actions: 4, xpGained: { cooking: 120 }, coinsGained: 0 },
    )
    expect(patch).toMatchObject({ actions: 4, xp: 120, coins: 0 })
  })

  it('counts thieving item rewards as seeds, not items', () => {
    const patch = sessionPatchFromResult(
      { type: 'thieving' } as any,
      { actions: 3, itemsGained: { potato_seed: 2, onion_seed: 1 } },
    )
    expect(patch.seeds).toBe(3)
    expect(patch.items).toBe(0)
  })

  it('derives gather item count from actions × qty', () => {
    const patch = sessionPatchFromResult(
      { type: 'gather', gatherTask: { qty: 2 } } as any,
      { actions: 5 },
    )
    expect(patch.items).toBe(10)
  })

  it('sums hunter reward quantities', () => {
    const patch = sessionPatchFromResult(
      { type: 'hunter' } as any,
      { actions: 2, rewards: [{ quantity: 3 }, { quantity: 4 }] },
    )
    expect(patch.items).toBe(7)
  })

  it('carries dungeoneering tokens', () => {
    const patch = sessionPatchFromResult(
      { type: 'skill', skill: 'dungeoneering' } as any,
      { actions: 1, dungeoneeringTokensGained: 9 },
    )
    expect(patch.tokens).toBe(9)
  })
})
