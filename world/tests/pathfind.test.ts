import { describe, expect, it } from 'vitest'
import { findPath, findPathAdjacent } from '../server/pathfind'

const open5x5 = ['.....', '.....', '.....', '.....', '.....']

describe('findPath', () => {
  it('finds a straight line on an open grid', () => {
    const path = findPath(open5x5, { x: 0, z: 0 }, { x: 4, z: 0 })
    expect(path).toEqual([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 }, { x: 4, z: 0 }])
  })

  it('returns a single-tile path when already at the destination', () => {
    const path = findPath(open5x5, { x: 2, z: 2 }, { x: 2, z: 2 })
    expect(path).toEqual([{ x: 2, z: 2 }])
  })

  it('routes around a wall', () => {
    const grid = ['.....', '.###.', '.....', '.....', '.....']
    const path = findPath(grid, { x: 0, z: 1 }, { x: 4, z: 1 })
    expect(path).not.toBeNull()
    expect(path![0]).toEqual({ x: 0, z: 1 })
    expect(path![path!.length - 1]).toEqual({ x: 4, z: 1 })
    // Must detour through row 0 or row 2 — never stepping onto a '#' in row 1.
    for (const step of path!) {
      if (step.z === 1) expect(step.x === 0 || step.x === 4).toBe(true)
    }
  })

  it('refuses to cut a corner between two diagonal walls', () => {
    // Walls at (2,1) and (1,2) block the direct diagonal step from (1,1) to
    // (2,2) — both cardinal cells adjacent to that step must be walkable for
    // it to be legal, and here neither is. A legal (longer) detour exists via
    // the open row 0 / column 0 / column 3 tiles.
    const grid = ['.....', '..#..', '.#...', '.....', '.....']
    const path = findPath(grid, { x: 1, z: 1 }, { x: 2, z: 2 })
    expect(path).not.toBeNull()
    // A corner-cut would be the direct 2-tile path [(1,1),(2,2)].
    expect(path!.length).toBeGreaterThan(2)
    expect(path![0]).toEqual({ x: 1, z: 1 })
    expect(path![path!.length - 1]).toEqual({ x: 2, z: 2 })
    // No consecutive pair in the path may be a diagonal step between (2,1) and (1,2).
    for (let i = 1; i < path!.length; i++) {
      const a = path![i - 1]
      const b = path![i]
      const dx = b.x - a.x
      const dz = b.z - a.z
      if (dx !== 0 && dz !== 0) {
        expect(grid[a.z][a.x + dx] !== '#' && grid[a.z + dz][a.x] !== '#').toBe(true)
      }
    }
  })

  it('returns null for an unreachable target', () => {
    const grid = ['.#.', '###', '.#.']
    const path = findPath(grid, { x: 0, z: 0 }, { x: 2, z: 2 })
    expect(path).toBeNull()
  })

  it('returns null for a blocked target on a plain walk', () => {
    const grid = ['.....', '..#..', '.....', '.....', '.....']
    expect(findPath(grid, { x: 0, z: 0 }, { x: 2, z: 1 })).toBeNull()
  })

  it('returns null for an out-of-bounds target', () => {
    expect(findPath(open5x5, { x: 0, z: 0 }, { x: 99, z: 99 })).toBeNull()
  })

  // Regression: BFS used to return equal-STEP-count paths that arced tiles
  // away from the straight line (diagonals cost the same as cardinals, so a
  // triangle detour "cost" nothing). Paths must stay inside the bounding
  // rectangle of start→destination on open ground.
  it('keeps a long straight-line walk perfectly straight', () => {
    const grid = Array.from({ length: 21 }, () => '.'.repeat(30))
    const path = findPath(grid, { x: 2, z: 10 }, { x: 28, z: 10 })
    expect(path).toHaveLength(27)
    for (const step of path!) expect(step.z).toBe(10)
  })

  it('never leaves the start→destination bounding box on open ground', () => {
    const grid = Array.from({ length: 21 }, () => '.'.repeat(30))
    const path = findPath(grid, { x: 3, z: 18 }, { x: 25, z: 4 })
    expect(path).toHaveLength(23) // Chebyshev-optimal: max(22, 14) + 1
    for (const step of path!) {
      expect(step.x).toBeGreaterThanOrEqual(3)
      expect(step.x).toBeLessThanOrEqual(25)
      expect(step.z).toBeGreaterThanOrEqual(4)
      expect(step.z).toBeLessThanOrEqual(18)
    }
  })

  it('uses no more diagonal steps than the short axis requires', () => {
    const grid = Array.from({ length: 10 }, () => '.'.repeat(20))
    const path = findPath(grid, { x: 1, z: 2 }, { x: 15, z: 6 })
    expect(path).toHaveLength(15) // max(14, 4) + 1
    let diagonals = 0
    for (let i = 1; i < path!.length; i++) {
      if (path![i].x !== path![i - 1].x && path![i].z !== path![i - 1].z) diagonals += 1
    }
    expect(diagonals).toBe(4)
  })

  it('truncates a path longer than maxLen', () => {
    const grid = Array.from({ length: 1 }, () => '.'.repeat(20))
    const path = findPath(grid, { x: 0, z: 0 }, { x: 19, z: 0 }, 5)
    expect(path).toHaveLength(5)
    expect(path![0]).toEqual({ x: 0, z: 0 })
    expect(path![4]).toEqual({ x: 4, z: 0 })
  })
})

describe('findPathAdjacent', () => {
  it('paths to the nearest walkable tile next to a blocked target', () => {
    const grid = ['.....', '..#..', '.....', '.....', '.....']
    const path = findPathAdjacent(grid, { x: 0, z: 0 }, { x: 2, z: 1 })
    expect(path).not.toBeNull()
    const last = path![path!.length - 1]
    // Must land on one of the 8 tiles surrounding (2,1), not on (2,1) itself.
    expect(Math.max(Math.abs(last.x - 2), Math.abs(last.z - 1))).toBe(1)
  })

  it('returns null when every tile adjacent to the target is blocked', () => {
    // (1,1) is the only walkable tile; all 8 tiles surrounding it are walls.
    const grid = ['###', '#.#', '###']
    const path = findPathAdjacent(grid, { x: 1, z: 1 }, { x: 1, z: 1 })
    expect(path).toBeNull()
  })

  it('picks the shortest adjacent path when multiple neighbours are walkable', () => {
    const path = findPathAdjacent(open5x5, { x: 0, z: 0 }, { x: 2, z: 2 })
    expect(path).not.toBeNull()
    // From (0,0), the nearest tile adjacent to (2,2) is (1,1) — 1 diagonal step.
    expect(path).toEqual([{ x: 0, z: 0 }, { x: 1, z: 1 }])
  })
})
