import { describe, expect, it } from 'vitest'
import { scatterPositions } from '../client/src/scatter'
import type { ScatterLayer } from '../shared/protocol'

// 6x6 zone: a walkable field with a blocked cross through the middle.
const W = 6
const H = 6
const collision = [
  '......',
  '......',
  '..##..',
  '..##..',
  '......',
  '......',
]
const layer: ScatterLayer = { model: 'bush', density: 50, scaleRange: [0.8, 1.2] }

describe('scatterPositions', () => {
  it('is deterministic for the same seed', () => {
    const a = scatterPositions(W, H, collision, new Set(), layer, 99)
    const b = scatterPositions(W, H, collision, new Set(), layer, 99)
    expect(a).toEqual(b)
  })

  it('changes with the seed', () => {
    const a = scatterPositions(W, H, collision, new Set(), layer, 1)
    const b = scatterPositions(W, H, collision, new Set(), layer, 2)
    expect(a).not.toEqual(b)
  })

  it('never places on a blocked tile', () => {
    const inst = scatterPositions(W, H, collision, new Set(), { ...layer, density: 100 }, 7)
    for (const it of inst) {
      const tx = Math.floor(it.x)
      const tz = Math.floor(it.z)
      expect(collision[tz][tx]).toBe('.')
    }
  })

  it('never places on an occupied tile', () => {
    const occupied = new Set(['0,0', '5,5', '1,4'])
    const inst = scatterPositions(W, H, collision, new Set(occupied), { ...layer, density: 100 }, 3)
    for (const it of inst) {
      expect(occupied.has(`${Math.floor(it.x)},${Math.floor(it.z)}`)).toBe(false)
    }
  })

  it('scales instance count with density', () => {
    const sparse = scatterPositions(W, H, collision, new Set(), { ...layer, density: 10 }, 5)
    const dense = scatterPositions(W, H, collision, new Set(), { ...layer, density: 90 }, 5)
    expect(dense.length).toBeGreaterThan(sparse.length)
  })

  it('respects a max-slope filter using the height sampler', () => {
    // Height rises sharply along x: slope large on the left half, flat elsewhere.
    const heightAt = (x: number): number => (x < 3 ? x * 2 : 6)
    const flatOnly = scatterPositions(W, H, collision, new Set(), { ...layer, density: 100, maxSlope: 0.5 }, 4, heightAt)
    for (const it of flatOnly) {
      // every kept tile must be on the flat (x>=3) side
      expect(Math.floor(it.x)).toBeGreaterThanOrEqual(3)
    }
  })

  it('produces jittered positions within the tile bounds', () => {
    const inst = scatterPositions(W, H, collision, new Set(), { ...layer, density: 100, jitter: 0.4 }, 8)
    for (const it of inst) {
      const tx = Math.floor(it.x)
      expect(it.x).toBeGreaterThanOrEqual(tx)
      expect(it.x).toBeLessThan(tx + 1)
      expect(it.scale).toBeGreaterThanOrEqual(0.8)
      expect(it.scale).toBeLessThanOrEqual(1.2)
    }
  })
})
