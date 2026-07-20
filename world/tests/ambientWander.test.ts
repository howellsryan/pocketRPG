// R2-9 (docs/open-world-changes-plan.md): ambient walkers (villagers/critters)
// must never pick, or step into, a blocked tile.
import { describe, expect, it } from 'vitest'
import {
  hashRand,
  isWalkableTile,
  legWaypoints,
  pickWanderTarget,
  walkerFramesAt,
  walkerSeed,
  AMBIENT_LEG_SECONDS,
  type Walker,
} from '../client/src/ambient'

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

  it('keeps at least MIN_SEPARATION from an avoided point when the rect has room', () => {
    const grid = Array.from({ length: 8 }, () => '.'.repeat(8))
    const seq = [0.5, 0.5, 0, 0]
    let calls = 0
    const rand = () => seq[calls++ % seq.length]
    // First candidate (4,4) lands exactly on the avoided point — too close —
    // so the picker must retry past it to the second candidate (0,0).
    const { x, z } = pickWanderTarget(grid, 0, 0, 8, 8, rand, [{ x: 4, z: 4 }])
    expect(x).toBe(0)
    expect(z).toBe(0)
  })

  it('falls back to a walkable point too close to avoid rather than spinning forever', () => {
    const grid = Array.from({ length: 8 }, () => '.'.repeat(8))
    // A single-tile rect: every candidate is (3,3), and the avoided point sits
    // well inside MIN_SEPARATION of it — no candidate can ever clear it.
    const { x, z } = pickWanderTarget(grid, 3, 3, 1, 1, () => 0, [{ x: 3.5, z: 3.5 }])
    expect(x).toBe(3)
    expect(z).toBe(3)
  })
})

// Item 9: ambient walkers must be a pure function of (zone, spec, instance,
// wall-clock time) — every client's simulation is a fresh computation from
// these, never a per-client RNG stream, so two players standing in the same
// town see the same villagers in the same spots doing the same thing.
describe('hashRand', () => {
  it('is deterministic: same inputs always produce the same output', () => {
    expect(hashRand(42, 1, 2, 3)).toBe(hashRand(42, 1, 2, 3))
  })

  it('spreads different inputs across the output range', () => {
    const values = new Set<number>()
    for (let i = 0; i < 50; i++) values.add(hashRand(42, i))
    expect(values.size).toBeGreaterThan(45) // collisions should be rare
  })

  it('always returns a value in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const v = hashRand(i * 7919, i, i * 3)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('walkerSeed', () => {
  it('is deterministic and distinct per (zone, spec, instance)', () => {
    expect(walkerSeed('lumbright', 0, 0)).toBe(walkerSeed('lumbright', 0, 0))
    const seeds = new Set([
      walkerSeed('lumbright', 0, 0),
      walkerSeed('lumbright', 0, 1),
      walkerSeed('lumbright', 1, 0),
      walkerSeed('varrick', 0, 0),
    ])
    expect(seeds.size).toBe(4)
  })
})

describe('legWaypoints', () => {
  const OPEN = Array.from({ length: 20 }, () => '.'.repeat(20))
  const walkers: Walker[] = [
    { seed: walkerSeed('town', 0, 0), rect: { cx: 0, cz: 0, cw: 10, ch: 10 } },
    { seed: walkerSeed('town', 0, 1), rect: { cx: 0, cz: 0, cw: 10, ch: 10 } },
  ]

  it('is a pure function of (collision, walkers, legIndex) — no history required', () => {
    const a = legWaypoints(OPEN, walkers, 5)
    const b = legWaypoints(OPEN, walkers, 5)
    expect(a).toEqual(b)
  })

  it('gives every walker a walkable point', () => {
    for (const p of legWaypoints(OPEN, walkers, 100)) {
      expect(isWalkableTile(OPEN, p.x, p.z)).toBe(true)
    }
  })

  it('keeps later walkers separated from earlier ones in the fixed order', () => {
    const points = legWaypoints(OPEN, walkers, 3)
    const dist = Math.hypot(points[0].x - points[1].x, points[0].z - points[1].z)
    // Same rect, same leg — without separation they could coincide exactly.
    expect(dist).toBeGreaterThan(0)
  })
})

describe('walkerFramesAt — the shared-simulation guarantee', () => {
  const OPEN = Array.from({ length: 20 }, () => '.'.repeat(20))
  const walkers: Walker[] = [
    { seed: walkerSeed('town', 0, 0), rect: { cx: 2, cz: 2, cw: 12, ch: 12 } },
    { seed: walkerSeed('town', 0, 1), rect: { cx: 2, cz: 2, cw: 12, ch: 12 } },
    { seed: walkerSeed('town', 1, 0), rect: { cx: 0, cz: 0, cw: 20, ch: 20 } },
  ]

  it('two independently-computed simulations agree at the same instant (this IS the fix)', () => {
    for (const t of [0, 1.5, AMBIENT_LEG_SECONDS, AMBIENT_LEG_SECONDS * 3.7, 86_400]) {
      const a = walkerFramesAt(OPEN, walkers, t)
      const b = walkerFramesAt(OPEN, walkers, t) // a second, independent call — not the same object
      expect(a).toEqual(b)
    }
  })

  it('a late-joining client converges with an early one at the same wall-clock moment', () => {
    // "Late join" here just means: query at a huge elapsedSeconds, with no
    // prior calls at smaller t — there is no replay step, so this either
    // works identically to any other t or it doesn't work at all.
    const farFuture = AMBIENT_LEG_SECONDS * 100_000 + 1.23
    const a = walkerFramesAt(OPEN, walkers, farFuture)
    const b = walkerFramesAt(OPEN, walkers, farFuture)
    expect(a).toEqual(b)
  })

  it('interpolates smoothly within a leg (monotonic progress from start to end waypoint)', () => {
    const legStart = AMBIENT_LEG_SECONDS * 4
    const start = walkerFramesAt(OPEN, walkers, legStart)[0]
    const mid = walkerFramesAt(OPEN, walkers, legStart + AMBIENT_LEG_SECONDS / 2)[0]
    const end = walkerFramesAt(OPEN, walkers, legStart + AMBIENT_LEG_SECONDS - 1e-6)[0]
    // mid should sit between start and end on both axes (or hold steady if
    // the leg is axis-degenerate — never overshoot past `end`).
    const between = (v: number, a: number, b: number): boolean => v >= Math.min(a, b) - 1e-9 && v <= Math.max(a, b) + 1e-9
    expect(between(mid.x, start.x, end.x)).toBe(true)
    expect(between(mid.z, start.z, end.z)).toBe(true)
  })

  it('every computed position stays walkable on an open (convex) rect', () => {
    // The straight line between two individually-walkable waypoints isn't
    // re-validated tile-by-tile (a deliberate trade-off — see ambient.ts's
    // module comment); this holds for every rect authored so far because
    // they're simple open areas, exercised here on a fully-open grid.
    for (let t = 0; t < AMBIENT_LEG_SECONDS * 10; t += 0.7) {
      for (const frame of walkerFramesAt(OPEN, walkers, t)) {
        expect(isWalkableTile(OPEN, frame.x, frame.z)).toBe(true)
      }
    }
  })
})
