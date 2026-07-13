import { describe, expect, it } from 'vitest'
import { createHeightField, proceduralCorners } from '../client/src/terrain'
import { groundHeight, setHeightSampler, tileToWorld } from '../client/src/scene'

describe('createHeightField', () => {
  it('samples flat zero everywhere when corners are null (T0 behaviour)', () => {
    const hf = createHeightField(4, 4, null)
    expect(hf.heightAt(0, 0)).toBe(0)
    expect(hf.heightAt(2.5, 3.1)).toBe(0)
    hf.dispose()
    setHeightSampler(null)
  })

  it('returns the exact corner height at grid corners', () => {
    // 2x2 tiles => 3x3 corners. Row-major, x fastest.
    const corners = new Float32Array([
      0, 1, 2,
      3, 4, 5,
      6, 7, 8,
    ])
    const hf = createHeightField(2, 2, corners)
    expect(hf.heightAt(0, 0)).toBe(0)
    expect(hf.heightAt(2, 0)).toBe(2)
    expect(hf.heightAt(0, 2)).toBe(6)
    expect(hf.heightAt(2, 2)).toBe(8)
    hf.dispose()
    setHeightSampler(null)
  })

  it('bilinearly interpolates between corners', () => {
    const corners = new Float32Array([
      0, 2,
      4, 6,
    ])
    const hf = createHeightField(1, 1, corners)
    expect(hf.heightAt(0.5, 0)).toBeCloseTo(1) // midpoint of 0..2
    expect(hf.heightAt(0, 0.5)).toBeCloseTo(2) // midpoint of 0..4
    expect(hf.heightAt(0.5, 0.5)).toBeCloseTo(3) // centre of 0,2,4,6
    hf.dispose()
    setHeightSampler(null)
  })

  it('clamps samples outside the grid to the edge, never NaN', () => {
    const corners = new Float32Array([0, 10, 0, 10])
    const hf = createHeightField(1, 1, corners)
    expect(hf.heightAt(-5, 0)).toBe(0)
    expect(hf.heightAt(99, 0)).toBe(10)
    expect(Number.isNaN(hf.heightAt(99, 99))).toBe(false)
    hf.dispose()
    setHeightSampler(null)
  })
})

describe('proceduralCorners', () => {
  it('produces a (width+1)*(height+1) grid', () => {
    const c = proceduralCorners(32, 32, 1337, 0.12, 0.8)
    expect(c.length).toBe(33 * 33)
  })

  it('is deterministic for the same seed (identical on every client)', () => {
    const a = proceduralCorners(16, 16, 42, 0.1, 1)
    const b = proceduralCorners(16, 16, 42, 0.1, 1)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('differs when the seed changes', () => {
    const a = proceduralCorners(16, 16, 1, 0.1, 1)
    const b = proceduralCorners(16, 16, 2, 0.1, 1)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  it('stays within [0, relief] and caps relief at 1.5', () => {
    const c = proceduralCorners(24, 24, 7, 0.2, 0.8)
    for (const h of c) {
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0.8 + 1e-6)
    }
    const capped = proceduralCorners(8, 8, 7, 0.2, 5)
    for (const h of capped) expect(h).toBeLessThanOrEqual(1.5 + 1e-6)
  })

  it('feeds a HeightField that lifts tileToWorld off zero', () => {
    const corners = proceduralCorners(16, 16, 1337, 0.15, 1.2)
    const hf = createHeightField(16, 16, corners)
    const anyLifted = Array.from({ length: 16 }, (_, i) => tileToWorld(i, i).y).some((y) => y > 0.01)
    expect(anyLifted).toBe(true)
    hf.dispose()
    setHeightSampler(null)
  })
})

describe('the height seam through tileToWorld', () => {
  it('leaves tileToWorld flat (y=0) with no sampler registered', () => {
    setHeightSampler(null)
    const p = tileToWorld(3, 5)
    expect(p.x).toBe(3.5)
    expect(p.z).toBe(5.5)
    expect(p.y).toBe(0)
  })

  it('lifts tileToWorld and groundHeight by the registered field', () => {
    const corners = new Float32Array([0, 0, 0, 0, 8, 0, 0, 0, 0]) // peak at corner (1,1)
    const hf = createHeightField(2, 2, corners)
    // tile (0,0) centre is world (0.5,0.5): quarter of the way to the (1,1) peak
    expect(groundHeight(0.5, 0.5)).toBeCloseTo(2)
    expect(tileToWorld(0, 0).y).toBeCloseTo(2)
    hf.dispose()
    setHeightSampler(null)
  })
})
