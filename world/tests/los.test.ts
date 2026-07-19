// Item 4 (P0): tile line-of-sight. Gating ranged/magic attacks on LOS is what
// kills the safespot exploit — a wall/pillar between shooter and target must
// block the shot in both directions.
import { describe, expect, it } from 'vitest'
import { hasLineOfSight } from '../server/los'

// 9x9 all-walkable grid; tests punch holes into copies.
const OPEN = Array.from({ length: 9 }, () => '.'.repeat(9))
function withWall(cells: [number, number][]): string[] {
  const rows = OPEN.map((r) => r.split(''))
  for (const [x, z] of cells) rows[z][x] = '#'
  return rows.map((r) => r.join(''))
}

describe('hasLineOfSight', () => {
  it('sees clear across open ground in every direction', () => {
    expect(hasLineOfSight(OPEN, { x: 1, z: 1 }, { x: 7, z: 1 })).toBe(true)
    expect(hasLineOfSight(OPEN, { x: 1, z: 1 }, { x: 1, z: 7 })).toBe(true)
    expect(hasLineOfSight(OPEN, { x: 1, z: 1 }, { x: 7, z: 7 })).toBe(true)
    expect(hasLineOfSight(OPEN, { x: 7, z: 2 }, { x: 1, z: 6 })).toBe(true)
  })

  it('is blocked by a wall tile directly on the line (horizontal + vertical)', () => {
    expect(hasLineOfSight(withWall([[4, 1]]), { x: 1, z: 1 }, { x: 7, z: 1 })).toBe(false)
    expect(hasLineOfSight(withWall([[1, 4]]), { x: 1, z: 1 }, { x: 1, z: 7 })).toBe(false)
  })

  it('is blocked by a pillar on a diagonal sightline', () => {
    // Straight diagonal from (1,1) to (7,7) passes through (4,4).
    expect(hasLineOfSight(withWall([[4, 4]]), { x: 1, z: 1 }, { x: 7, z: 7 })).toBe(false)
  })

  it('excludes the endpoints — an adjacent target is always visible', () => {
    // A wall ON the target tile (endpoint) does not block; only what's between does.
    expect(hasLineOfSight(withWall([[2, 1]]), { x: 1, z: 1 }, { x: 2, z: 1 })).toBe(true)
  })

  it('does not over-block: a single pillar the line only grazes still lets sight past', () => {
    // Shooting (1,1)->(5,2): the shallow line does not pass through (3,3), so a
    // wall there must not block it.
    expect(hasLineOfSight(withWall([[3, 3]]), { x: 1, z: 1 }, { x: 5, z: 2 })).toBe(true)
  })
})
