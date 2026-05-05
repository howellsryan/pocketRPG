import { describe, it, expect } from 'vitest'
import { computeIdleElapsedMs } from '../src/utils/idleElapsed.js'

const MIN = 60_000
const HOUR = 60 * MIN

describe('computeIdleElapsedMs', () => {
  it('prefers cloud-server-stamped elapsed when available', () => {
    const now = 1_000_000
    const elapsed = computeIdleElapsedMs({
      now,
      perfNow: 5_000,
      hiddenAt: now - 10 * MIN,
      hiddenAtPerf: 100,
      cloudServerNow: 2_000_000,
      cloudLastActiveAt: 2_000_000 - 30 * MIN,
      clockWatermark: 0,
    })
    expect(elapsed).toBe(30 * MIN)
  })

  it('uses wall-clock since cloud lastActiveAt when serverNow missing', () => {
    const now = 5_000_000
    const elapsed = computeIdleElapsedMs({
      now,
      perfNow: 1_000,
      hiddenAt: now - 5 * MIN,
      hiddenAtPerf: 500,
      cloudServerNow: null,
      cloudLastActiveAt: now - 45 * MIN,
      clockWatermark: now - 60 * MIN,
    })
    expect(elapsed).toBe(45 * MIN)
  })

  it('takes the larger of perf-clock and wall-clock for same session', () => {
    // perf-clock paused (mobile suspend) — only advanced 1.5s while the wall
    // clock advanced 30 minutes. We must trust the wall clock so the player
    // sees the correct away-time and the modal still triggers.
    const now = 1_000_000
    const elapsed = computeIdleElapsedMs({
      now,
      perfNow: 1_500,
      hiddenAt: now - 30 * MIN,
      hiddenAtPerf: 0,
      cloudServerNow: null,
      cloudLastActiveAt: null,
      clockWatermark: now - 30 * MIN - 1,
    })
    expect(elapsed).toBe(30 * MIN)
  })

  it('uses perf-clock when wall clock cannot be trusted (rollback)', () => {
    // Wall clock rolled back below the watermark — wall diff collapses to 0.
    // perf-clock still advanced normally; we should fall back to it.
    const now = 1_000_000
    const elapsed = computeIdleElapsedMs({
      now,
      perfNow: 305_000,
      hiddenAt: now + 10 * MIN, // hide stamped in the future ⇒ wall diff ≤ 0
      hiddenAtPerf: 5_000,
      cloudServerNow: null,
      cloudLastActiveAt: null,
      clockWatermark: now + 60 * MIN, // watermark > now ⇒ rollback detected
    })
    expect(elapsed).toBe(300_000)
  })

  it('caps elapsed at the 24h max-offline window', () => {
    const now = 100_000_000
    const elapsed = computeIdleElapsedMs({
      now,
      perfNow: 0,
      hiddenAt: now - 72 * HOUR,
      hiddenAtPerf: null,
      cloudServerNow: null,
      cloudLastActiveAt: null,
      clockWatermark: 0,
    })
    expect(elapsed).toBe(24 * HOUR)
  })

  it('returns 0 when no inputs are usable', () => {
    const elapsed = computeIdleElapsedMs({
      now: 1_000_000,
      perfNow: 0,
      hiddenAt: null,
      hiddenAtPerf: null,
      cloudServerNow: null,
      cloudLastActiveAt: null,
      clockWatermark: 0,
    })
    expect(elapsed).toBe(0)
  })

  it('falls back to wall-clock-only path when no perf clock baseline exists', () => {
    const now = 9_000_000
    const elapsed = computeIdleElapsedMs({
      now,
      perfNow: 100,
      hiddenAt: now - 12 * MIN,
      hiddenAtPerf: null,
      cloudServerNow: null,
      cloudLastActiveAt: null,
      clockWatermark: now - 60 * MIN,
    })
    expect(elapsed).toBe(12 * MIN)
  })

  it('clamps wall-clock-only path to zero on rollback', () => {
    const now = 9_000_000
    const elapsed = computeIdleElapsedMs({
      now,
      perfNow: 100,
      hiddenAt: now - 12 * MIN,
      hiddenAtPerf: null,
      cloudServerNow: null,
      cloudLastActiveAt: null,
      clockWatermark: now + 1, // watermark ahead of now ⇒ rollback
    })
    expect(elapsed).toBe(0)
  })
})
