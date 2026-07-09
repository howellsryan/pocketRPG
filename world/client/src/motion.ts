// Pure movement-interpolation helpers, kept three.js-free so vitest can cover
// them without a DOM/WebGL environment.

export const MOVE_DURATION_MS = 600
export const CATCHUP_DURATION_MS = 440
export const SNAP_QUEUE_LEN = 4

/** Per-segment playback duration: when more waypoints are already queued the
 * client is behind the server, so it traverses slightly faster to catch up
 * without visible teleports. */
export function segmentDurationMs(remainingQueued: number): number {
  return remainingQueued > 0 ? CATCHUP_DURATION_MS : MOVE_DURATION_MS
}

export function shouldSnap(queueLength: number): boolean {
  return queueLength >= SNAP_QUEUE_LEN
}

/** Yaw (radians around +Y) that points a +Z-forward model along (dx, dz). */
export function yawToward(dx: number, dz: number): number {
  return Math.atan2(dx, dz)
}

/** Signed shortest-arc difference target−current, normalized to [-π, π). */
export function yawDelta(current: number, target: number): number {
  const TAU = Math.PI * 2
  return ((((target - current + Math.PI) % TAU) + TAU) % TAU) - Math.PI
}

/** Rotates `current` toward `target` by at most `maxStep`, taking the
 * shortest arc; returns `target` exactly once within range. */
export function stepYaw(current: number, target: number, maxStep: number): number {
  const delta = yawDelta(current, target)
  if (Math.abs(delta) <= maxStep) return target
  return current + Math.sign(delta) * maxStep
}
