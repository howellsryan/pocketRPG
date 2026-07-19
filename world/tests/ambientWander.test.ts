// R2-9 (docs/open-world-changes-plan.md): ambient walkers (villagers/critters)
// must never pick, or step into, a blocked tile.
import { describe, expect, it } from 'vitest'
import { isWalkableTile, pickWanderTarget } from '../client/src/ambient'

const OPEN = Array.from({ length: 8 }, () => '.'.repeat(8))

describe('isWalkableTile', () => {
  it('reads "." as walkable', () => {
    expect(isWalkableTile(OPEN, 3.5, 3.5)).toBe(true)
  })

  it('reads "#" as blocked', () => {
    const grid = OPEN.map((row, z) => (z === 3 ? row.slice(0, 3) + '#' + row.slice(4) : row))
    expect(isWalkableTile(grid, 3.5, 3.5)).toBe(false)
  })

  it('treats out-of-bounds as blocked', () => {
    expect(isWalkableTile(OPEN, -1, 0)).toBe(false)
    expect(isWalkableTile(OPEN, 100, 100)).toBe(false)
  })
})

describe('pickWanderTarget', () => {
  it('retries past blocked candidates and only ever returns a walkable point', () => {
    // Wall off everything except a 2x2 pocket in the corner of the rect.
    const grid = Array.from({ length: 8 }, (_, z) =>
      Array.from({ length: 8 }, (_, x) => (x >= 2 && x < 4 && z >= 2 && z < 4 ? '.' : '#')).join('')
    )
    // Cycles 3 misses then a hit inside the pocket (r in [0.25, 0.5) on both
    // axes) — the phase shifts call to call since the counter never resets,
    // but the cycle repeats often enough inside MAX_TARGET_ATTEMPTS to land.
    const seq = [0.05, 0.05, 0.6, 0.6, 0.1, 0.9, 0.3, 0.3]
    let calls = 0
    const rand = () => seq[calls++ % seq.length]
    for (let i = 0; i < 20; i++) {
      const { x, z } = pickWanderTarget(grid, 0, 0, 8, 8, rand)
      expect(isWalkableTile(grid, x, z)).toBe(true)
    }
  })

  it('degrades to the rect centre without looping forever when fully blocked', () => {
    const grid = Array.from({ length: 8 }, () => '#'.repeat(8))
    const { x, z } = pickWanderTarget(grid, 2, 2, 4, 4)
    expect(x).toBe(4)
    expect(z).toBe(4)
  })
})
