import { describe, expect, it } from 'vitest'
import {
  CATCHUP_DURATION_MS,
  MOVE_DURATION_MS,
  RUN_DIST_SQ_MIN,
  SNAP_QUEUE_LEN,
  animForSegment,
  gaitBob,
  isAttackAnim,
  resolveGltfAnim,
  segmentDurationMs,
  shouldSnap,
  stepYaw,
  yawDelta,
  yawToward,
} from '../client/src/motion'

describe('segmentDurationMs', () => {
  it('plays at tick speed when nothing else is queued', () => {
    expect(segmentDurationMs(0)).toBe(MOVE_DURATION_MS)
  })
  it('catches up faster when waypoints are backed up', () => {
    expect(segmentDurationMs(1)).toBe(CATCHUP_DURATION_MS)
    expect(segmentDurationMs(3)).toBe(CATCHUP_DURATION_MS)
    expect(CATCHUP_DURATION_MS).toBeLessThan(MOVE_DURATION_MS)
  })
})

describe('shouldSnap', () => {
  it('only snaps once the queue is hopelessly behind', () => {
    expect(shouldSnap(SNAP_QUEUE_LEN - 1)).toBe(false)
    expect(shouldSnap(SNAP_QUEUE_LEN)).toBe(true)
  })
})

describe('yawToward', () => {
  it('faces +Z when moving toward +Z', () => {
    expect(yawToward(0, 1)).toBeCloseTo(0)
  })
  it('faces +X when moving toward +X', () => {
    expect(yawToward(1, 0)).toBeCloseTo(Math.PI / 2)
  })
  it('faces -Z when moving toward -Z', () => {
    expect(Math.abs(yawToward(0, -1))).toBeCloseTo(Math.PI)
  })
})

describe('yawDelta / stepYaw', () => {
  it('returns the signed shortest arc', () => {
    expect(yawDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2)
    expect(yawDelta(0, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2)
  })
  it('crosses the ±π seam the short way', () => {
    const from = Math.PI - 0.1
    const to = -Math.PI + 0.1
    expect(yawDelta(from, to)).toBeCloseTo(0.2)
  })
  it('steps by at most maxStep and lands exactly on target', () => {
    const stepped = stepYaw(0, Math.PI, 0.25)
    expect(Math.abs(stepped)).toBeCloseTo(0.25)
    expect(stepYaw(0.9, 1, 0.25)).toBe(1)
  })
})

describe('animForSegment', () => {
  it('reads a 1-tile step, including a diagonal one, as a walk', () => {
    expect(animForSegment(1)).toBe('walk')
    expect(animForSegment(2)).toBe('walk')
  })
  it('reads a 2-tile running step as a run', () => {
    expect(animForSegment(4)).toBe('run')
    expect(animForSegment(8)).toBe('run')
  })
  it('brackets strictly between diagonal-walk (2) and straight-run (4)', () => {
    expect(RUN_DIST_SQ_MIN).toBeGreaterThan(2)
    expect(RUN_DIST_SQ_MIN).toBeLessThanOrEqual(4)
  })
})

describe('gaitBob', () => {
  it('gives a stationary boss no offset at all (idle clip only)', () => {
    expect(gaitBob(0, false)).toEqual({ y: 0, rotZ: 0 })
    expect(gaitBob(1.23, false)).toEqual({ y: 0, rotZ: 0 })
  })

  it('bobs upward (never negative — feet never sink below the idle pose) while moving', () => {
    for (let t = 0; t < 2; t += 0.05) {
      expect(gaitBob(t, true).y).toBeGreaterThanOrEqual(0)
    }
  })

  it('rocks side to side (signed) at half the bob frequency while moving', () => {
    const rocks = Array.from({ length: 40 }, (_, i) => gaitBob(i * 0.05, true).rotZ)
    expect(rocks.some((r) => r > 0)).toBe(true)
    expect(rocks.some((r) => r < 0)).toBe(true)
  })

  it('y repeats twice per stride cycle (both feet land once each)', () => {
    // y = |sin(phase)|, so its period is half of rotZ's full stride cycle.
    const yPeriod = 1 / (2 * 2.2) // BOB_HZ
    const a = gaitBob(0.37, true)
    const b = gaitBob(0.37 + yPeriod, true)
    expect(a.y).toBeCloseTo(b.y, 5)
  })

  it('rotZ repeats once per full stride cycle', () => {
    const rockPeriod = 2 / 2.2 // BOB_HZ
    const a = gaitBob(0.37, true)
    const b = gaitBob(0.37 + rockPeriod, true)
    expect(a.rotZ).toBeCloseTo(b.rotZ, 5)
  })
})

describe('isAttackAnim', () => {
  it('is true for the three swing anims', () => {
    expect(isAttackAnim('attack')).toBe(true)
    expect(isAttackAnim('attack_ranged')).toBe(true)
    expect(isAttackAnim('attack_magic')).toBe(true)
  })
  it('is false for looping and death anims', () => {
    for (const n of ['idle', 'walk', 'run', 'mine', 'die'] as const) expect(isAttackAnim(n)).toBe(false)
  })
})

describe('resolveGltfAnim (one-shot swing latch)', () => {
  it('fires a fresh swing once and holds the base anim off', () => {
    expect(resolveGltfAnim('idle', 'attack', false, false, false)).toEqual({ fireSwing: true, latched: true, playBase: false })
  })
  it('does not re-fire the same swing while still latched', () => {
    expect(resolveGltfAnim('idle', 'attack', false, true, true)).toEqual({ fireSwing: false, latched: true, playBase: false })
  })
  it('keeps a landed swing playing when the server drops back to idle mid-clip', () => {
    // The tick after a swing the server sends idle; the attack clip is still
    // running, so the mixer must NOT be handed back to idle yet.
    expect(resolveGltfAnim('idle', null, false, true, true)).toEqual({ fireSwing: false, latched: false, playBase: false })
  })
  it('returns to the base anim once the swing clip has finished', () => {
    expect(resolveGltfAnim('idle', null, false, false, false)).toEqual({ fireSwing: false, latched: false, playBase: true })
  })
  it('fires a swing signalled mid-stride instead of dropping it', () => {
    // Replaces the old "movement wins over a stale attack signal" expectation,
    // which was the one-hit-kill bug: the server resolves the first swing on the
    // very tick the last step lands, so the client is ALWAYS mid-segment when it
    // arrives. Dropped there, a kill that ends the fight in one blow never
    // animated at all — the next diff is already back to idle.
    expect(resolveGltfAnim('run', 'attack', true, false, false)).toEqual({ fireSwing: true, latched: true, playBase: true })
  })
  it('keeps the stride clip playing while an impact-aligned wind-up waits out its lead', () => {
    // A monster with attackImpactSec is pre-signalled ticks ahead of the blow
    // and its clip start is held back by the sub-tick nudge; it keeps walking
    // until the clip actually starts.
    expect(resolveGltfAnim('run', 'attack', true, true, false).playBase).toBe(true)
    expect(resolveGltfAnim('run', 'attack', true, true, true).playBase).toBe(false)
  })
})

