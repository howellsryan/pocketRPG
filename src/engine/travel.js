/**
 * Travel — pure logic for moving between places over the road graph.
 * Phase 2 of the map-driven overhaul (docs/map-driven-overhaul-plan.md).
 *
 * Travel is modelled as a BACKGROUND `activeTask` of `type: 'travel'` so it flows
 * through the same idle/offline catch-up machinery as the other timed activities
 * (it is a one-shot countdown to arrival, exactly like a one-shot minigame). It
 * costs game time (the road tick weights) and resolves during offline catch-up —
 * decision #2 in the plan. No rewards, no ledger entry.
 */
import { shortestPath, normaliseLocation, getPlace, pathLegs } from './world.js'

// Engine tick is 600ms. Inlined (not a top-level const) to avoid a duplicate
// `TICK_MS` declaration in the flattened single-file bundle — other engine
// modules already declare their own. See build_single.cjs duplicate guard.
const TRAVEL_TICK_MS = 600

/**
 * Build a travel task from `from` to `to`, or null if the trip is impossible /
 * pointless (unknown/unreachable destination, or already there).
 */
export function createTravelTask(from, to, autoStart = null, returnTo = null) {
  const start = normaliseLocation(from)
  if (start === to) return null
  const res = shortestPath(start, to)
  if (!res || res.ticks <= 0) return null
  const task = {
    type: 'travel',
    from: start,
    dest: to,
    path: res.path,
    totalTicks: res.ticks,
    ticksRemaining: res.ticks,
  }
  // Optional resumable action to fire on arrival (set when a gated activity start sent
  // the player travelling). Rides the persisted task so it survives idle/tab-return.
  if (autoStart) task.autoStart = autoStart
  // Screen the player was on when this trip started (`{ screen, data }`) — arrival
  // hands it to the resumed screen's back/stop buttons instead of a hardcoded
  // destination, so they return to wherever the player actually came from.
  if (returnTo) task.returnTo = returnTo
  return task
}

/**
 * Advance a travel task by elapsed wall-clock. Returns:
 *   { arrived, ticksRemaining, task }
 * `arrived` is true once the countdown reaches 0; `task` is the same shape with
 * an updated `ticksRemaining` (0 when arrived). A non-travel/empty task is a no-op.
 */
export function advanceTravel(task, elapsedMs) {
  if (!task || task.type !== 'travel') return { arrived: false, ticksRemaining: 0, task }
  const total = task.totalTicks ?? 0
  const prev = task.ticksRemaining ?? total
  const elapsedTicks = Math.floor((Number(elapsedMs) || 0) / TRAVEL_TICK_MS)
  const remaining = Math.max(0, prev - elapsedTicks)
  return {
    arrived: remaining <= 0,
    ticksRemaining: remaining,
    task: { ...task, ticksRemaining: remaining },
  }
}

/**
 * Milliseconds left over after a travel task arrives within `elapsedMs`. Offline
 * catch-up spends this remainder on the activity the trip was launched for (its
 * `autoStart`) instead of stranding the player idle at the destination — the walk
 * costs `ticksRemaining` ticks, everything past that is time to fight/skill.
 * Zero if the trip didn't finish inside the window.
 */
export function travelLeftoverMs(task, elapsedMs) {
  if (!task || task.type !== 'travel') return 0
  const travelTicks = task.ticksRemaining ?? task.totalTicks ?? 0
  return Math.max(0, (Number(elapsedMs) || 0) - travelTicks * TRAVEL_TICK_MS)
}

/** Fraction of the journey completed, 0..1. */
export function travelFraction(task) {
  if (!task || task.type !== 'travel') return 0
  const total = task.totalTicks ?? 0
  if (total <= 0) return 1
  const remaining = task.ticksRemaining ?? total
  return Math.max(0, Math.min(1, (total - remaining) / total))
}

/**
 * Where a cancelled ("turn back") journey leaves the player: the last node fully
 * reached along the route (plan §9 open question 2 — completed legs keep their
 * progress; a partial leg walks back to the node it started from, never forward).
 * Returns the origin for a fresh/invalid task.
 */
export function travelCancelLocation(task) {
  if (!task || task.type !== 'travel') return null
  let loc = normaliseLocation(task.from)
  const total = task.totalTicks ?? 0
  const done = total - (task.ticksRemaining ?? total)
  let acc = 0
  for (const leg of pathLegs(task.path)) {
    if (done < acc + leg.ticks) break
    acc += leg.ticks
    loc = normaliseLocation(leg.to)
  }
  return loc
}

/** Human-readable destination name for toasts/UI. */
export function travelDestName(task) {
  if (!task || task.type !== 'travel') return ''
  return getPlace(task.dest)?.name || task.dest || ''
}
