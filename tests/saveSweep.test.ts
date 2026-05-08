import { describe, it, expect } from 'vitest'
import { shouldSweepOnSave } from '../functions/api/save.js'

describe('shouldSweepOnSave', () => {
  it('fires when the random sample is below the gate', () => {
    expect(shouldSweepOnSave(() => 0)).toBe(true)
    expect(shouldSweepOnSave(() => 0.04)).toBe(true)
  })

  it('skips when the random sample is at or above the gate', () => {
    expect(shouldSweepOnSave(() => 0.05)).toBe(false)
    expect(shouldSweepOnSave(() => 0.5)).toBe(false)
    expect(shouldSweepOnSave(() => 0.999)).toBe(false)
  })

  it('uses Math.random by default (smoke test for ~5% rate)', () => {
    let hits = 0
    const N = 5000
    for (let i = 0; i < N; i++) if (shouldSweepOnSave()) hits++
    const rate = hits / N
    // Wide envelope to keep the test stable; we just want to confirm we
    // gated to a small fraction rather than fire-on-every-save behavior.
    expect(rate).toBeGreaterThan(0.02)
    expect(rate).toBeLessThan(0.10)
  })
})
