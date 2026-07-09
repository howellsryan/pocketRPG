import { describe, expect, it } from 'vitest'
import {
  CATCHUP_DURATION_MS,
  MOVE_DURATION_MS,
  SNAP_QUEUE_LEN,
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
