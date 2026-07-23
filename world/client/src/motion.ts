// Pure movement-interpolation helpers, kept three.js-free so vitest can cover
// them without a DOM/WebGL environment.
import type { AnimName } from './entities'

/** The server anim states that are one-shot swings (as opposed to the looping
 * idle/walk/run and the one-shot die) — including the special-attack combo. */
export const ATTACK_ANIMS: readonly AnimName[] = ['attack', 'attack_ranged', 'attack_magic', 'attack_special']
export function isAttackAnim(name: AnimName): boolean {
  return ATTACK_ANIMS.includes(name)
}

/** Pure per-frame animation decision for a GLB-rigged entity. `name` is the anim
 * it wants this frame, `attackPlaying` whether a one-shot attack clip is still
 * running. Returns whether to fire a fresh swing (edge-detected via `latched`),
 * the next latch value, and whether to hand the mixer back to the base
 * (idle/walk) anim. The server flags an attack for only the tick a swing lands
 * then returns to idle, so without this the swing would be cut off after ~1
 * tick — this keeps it playing to completion, matching the combat arena. */
export function resolveGltfAnim(
  name: AnimName,
  moving: boolean,
  latched: boolean,
  attackPlaying: boolean,
): { fireSwing: boolean; latched: boolean; playBase: boolean } {
  if (!moving && isAttackAnim(name)) return { fireSwing: !latched, latched: true, playBase: false }
  return { fireSwing: false, latched: false, playBase: !attackPlaying }
}

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

/** Planar (x/z) distance² above which a segment reads as a run rather than a
 * walk: a straight 1-tile step is 1, a diagonal 1-tile step is 2, a straight
 * 2-tile running step is 4 — this sits strictly between diagonal-walk and
 * straight-run so terrain-perturbed lengths never bracket the wrong side. */
export const RUN_DIST_SQ_MIN = 3

export function animForSegment(planarDistSq: number): 'walk' | 'run' {
  return planarDistSq >= RUN_DIST_SQ_MIN ? 'run' : 'walk'
}

// Bosses whose GLB ships no walk clip (e.g. Warlord Grondar — see
// monsterModels.ts's `noLocomotionClip`) alias walk to idle in makeAnimator,
// which reads as a frozen statue gliding across the ground. This gives them a
// cheap procedural gait instead: a vertical bob + a slight side-to-side rock,
// applied only while moving, on top of whatever the idle clip is doing.
const BOB_HZ = 2.2
const BOB_AMPLITUDE = 0.035
const ROCK_AMPLITUDE_RAD = 0.05

export type GaitBob = { y: number; rotZ: number }

/** Pure: procedural gait offset for a given elapsed time (seconds) and
 * movement state. Stationary bosses get no offset — only the idle clip. */
export function gaitBob(elapsedSeconds: number, moving: boolean): GaitBob {
  if (!moving) return { y: 0, rotZ: 0 }
  const phase = elapsedSeconds * BOB_HZ * Math.PI * 2
  // Double-frequency bob (both feet land per stride) vs. single-frequency
  // rock (weight shifts once per stride) — this is what keeps a plain sine
  // bob from reading as a bounce-in-place.
  return { y: Math.abs(Math.sin(phase)) * BOB_AMPLITUDE, rotZ: Math.sin(phase / 2) * ROCK_AMPLITUDE_RAD }
}
