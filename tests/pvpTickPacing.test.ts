import { describe, expect, it } from 'vitest'
import { shouldAdvancePvpTick } from '../functions/api/pvp/match/[id]/tick.js'

describe('shouldAdvancePvpTick', () => {
  it('allows first tick immediately when no last_tick_at exists', () => {
    const out = shouldAdvancePvpTick(10_000, 0)
    expect(out.advance).toBe(true)
    expect(out.nextTickAt).toBe(10_600)
  })

  it('blocks advancement when called too early', () => {
    const out = shouldAdvancePvpTick(1_000, 800)
    expect(out.advance).toBe(false)
    expect(out.nextTickAt).toBe(1_400)
  })

  it('allows advancement once tick window (+grace) is reached', () => {
    const out = shouldAdvancePvpTick(1_326, 800) // 1326 + 75 >= 1400
    expect(out.advance).toBe(true)
    expect(out.nextTickAt).toBe(1_400)
  })
})
