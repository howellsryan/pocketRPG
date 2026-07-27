import { describe, it, expect } from 'vitest'
import {
  COOP_POLL_FALLBACK_MS,
  COOP_POLL_MAX_MS,
  COOP_POLL_MIN_MS,
  coopPollLead,
  nextPollDelayMs,
} from '../src/utils/coopPolling.js'

describe('coopPolling — staying in step with the room', () => {
  it('aims at what is left of the room\'s beat', () => {
    // The old client waited a flat tick after each response landed, so its
    // period was a tick PLUS the round trip and it drifted steadily out of
    // phase with a fight that beats every 600ms.
    expect(nextPollDelayMs(420, 100)).toBe(420 + coopPollLead(100))
    expect(nextPollDelayMs(0, 0)).toBe(COOP_POLL_MIN_MS)
  })

  it('leads by half the round trip, capped', () => {
    expect(coopPollLead(0)).toBe(40)
    expect(coopPollLead(200)).toBe(140)
    expect(coopPollLead(10_000)).toBe(250)
  })

  it('falls back to a flat tick when the room says nothing', () => {
    // An older Worker sends no hint; it must keep polling at the old rate
    // rather than at the floor.
    expect(nextPollDelayMs(undefined, 0)).toBe(COOP_POLL_FALLBACK_MS + 40)
    expect(nextPollDelayMs(null, 0)).toBe(COOP_POLL_FALLBACK_MS + 40)
    expect(nextPollDelayMs(-5, 0)).toBe(COOP_POLL_FALLBACK_MS + 40)
  })

  it('never spins and never sleeps through a fight', () => {
    expect(nextPollDelayMs(1, 0)).toBeGreaterThanOrEqual(COOP_POLL_MIN_MS)
    expect(nextPollDelayMs(60_000, 5_000)).toBe(COOP_POLL_MAX_MS)
  })
})
