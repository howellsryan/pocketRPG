/**
 * journeys — Phase 5 of the map-driven overhaul (docs/map-driven-overhaul-plan.md):
 * active, multi-step, place-bound clue/quest journeys.
 *
 * A journey is a chain of ordinary `type:'travel'` tasks carrying a `journey`
 * descriptor: travel to waypoint 1 → *search* it (a zero-distance travel dwell) →
 * travel to waypoint 2 → search → … → the final search completes the clue/quest via
 * the exact same completion path idling uses (App: completeClueSolve /
 * handleQuestCompletion). Riding the travel task means the whole existing travel
 * stack — the live App tick, offline catch-up, save/resume, the World Map banner,
 * turn-back — works unchanged; only the arrival handler asks this module "what next".
 *
 * Journeys are the ONLY clue/quest flow: the old stationary timers are retired
 * (legacy saved tasks still tick out in App.jsx, but nothing starts them). The
 * background/idle character is preserved because a journey IS a travel task — it
 * ticks on any screen and catches up offline — while total time is the content's
 * advertised idle duration plus road time, and active players compress the roads
 * by teleporting between waypoints (engine/teleports.js).
 *
 * Pure logic, no UI imports (engine layer — CLAUDE.md §3).
 */
import { getWorld, getPlace, shortestPath, normaliseLocation } from './world.js'
import { advanceTravel } from './travel.js'

// Engine tick is 600ms; inlined to avoid a duplicate TICK_MS in the flattened
// single-file bundle (see build_single.cjs duplicate guard).
const JOURNEY_TICK_MS = 600

/**
 * Fraction of the idle duration a journey spends searching (travel comes on
 * top). 1 = a journey takes the content's full advertised duration — active
 * players save only the road time by teleporting ahead, never search time.
 */
export const JOURNEY_TIME_FACTOR = 1

// ── deterministic seeding ───────────────────────────────────────────────────
// The same clue tier started from the same place always walks the same trail, so
// a reload/resync can never re-roll a shorter journey.
function jnHash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
function jnRand(seed) {
  let a = seed
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 2–4 waypoints, scaled by how long the content would take to idle. */
export function journeyStepCount(idleTicks) {
  const t = Number(idleTicks) || 0
  return t <= 600 ? 2 : t <= 2000 ? 3 : 4
}

/**
 * Pick the waypoints for a journey from `from`: places sorted by road distance are
 * split into `n` contiguous bands (near → far) and one is drawn from each, so the
 * trail always leads farther afield. Deterministic per (kind, ref, from).
 */
function pickWaypoints(kind, ref, from, n) {
  const world = getWorld()
  const candidates = Object.keys(world.places)
    .filter((id) => id !== from)
    .map((id) => ({ id, ticks: shortestPath(from, id)?.ticks ?? Infinity }))
    .filter((c) => Number.isFinite(c.ticks))
    .sort((a, b) => a.ticks - b.ticks)
  if (candidates.length < n) return null
  const rand = jnRand(jnHash(`${kind}:${ref}:${from}`))
  const steps = []
  for (let i = 0; i < n; i++) {
    const lo = Math.floor((i / n) * candidates.length)
    const hi = Math.floor(((i + 1) / n) * candidates.length)
    steps.push(candidates[lo + Math.floor(rand() * Math.max(1, hi - lo))].id)
  }
  return steps
}

/**
 * Build the first task of a journey, or null if no route exists.
 *   kind      'clue' | 'quest'
 *   ref       stable content id (clue task id / quest id) — seeds the trail
 *   name/icon for banners + toasts
 *   idleTicks how long the idle alternative would take (sets steps + search time)
 *   payload   serialisable blob the App needs to complete the content on the final
 *             search (the CLUE_TASKS entry / the quest object) — rides the saved task
 *   from      player's current place id
 */
export function planJourney({ kind, ref, name, icon, idleTicks, payload, from }) {
  const start = normaliseLocation(from)
  const n = journeyStepCount(idleTicks)
  const steps = pickWaypoints(kind, ref, start, n)
  if (!steps) return null
  const dwellTicks = Math.max(10, Math.round(((Number(idleTicks) || 0) * JOURNEY_TIME_FACTOR) / n))
  const journey = { kind, ref, name, icon, steps, step: 0, phase: 'travel', dwellTicks, payload }
  return journeyLegTask(start, steps[0], journey)
}

/**
 * Canonical planners for the two journey kinds — the only way clues and quests
 * start (the stationary idle timers are retired; journeys ARE the background
 * flow, ticking and catching up offline like any travel task). Shared by the
 * screens' start buttons and the App's auto-chaining (next scroll / next queued
 * quest), so a chained journey is identical to a hand-started one.
 */
export function planClueJourney(clueTask, from) {
  return planJourney({
    kind: 'clue',
    ref: clueTask.id,
    name: `${(clueTask.name || '').replace(/^Complete /, '')} Trail`,
    icon: '🗺️',
    idleTicks: clueTask.ticks,
    payload: clueTask,
    from,
  })
}

export function planQuestJourney(quest, from) {
  return planJourney({
    kind: 'quest',
    ref: quest.id,
    name: quest.name,
    icon: '📜',
    idleTicks: Math.max(1, Math.ceil(((Number(quest.durationSeconds) || 0) * 1000) / JOURNEY_TICK_MS)),
    payload: quest,
    from,
  })
}

/** A travel leg carrying the journey. */
function journeyLegTask(from, to, journey) {
  const res = shortestPath(from, to)
  if (!res || res.ticks <= 0) return null
  return {
    type: 'travel',
    from,
    dest: to,
    path: res.path,
    totalTicks: res.ticks,
    ticksRemaining: res.ticks,
    journey,
  }
}

/** A zero-distance "search the waypoint" dwell, still an ordinary travel task. */
function journeyDwellTask(place, journey) {
  return {
    type: 'travel',
    from: place,
    dest: place,
    path: [place],
    totalTicks: journey.dwellTicks,
    ticksRemaining: journey.dwellTicks,
    journey: { ...journey, phase: 'search' },
  }
}

export function isJourneyTask(task) {
  return !!(task && task.type === 'travel' && task.journey)
}

/**
 * A journey travel task just hit 0 ticks — decide what happens next:
 *   { kind: 'search',   next }  arrived at a waypoint → start searching it
 *   { kind: 'leg',      next }  searched a waypoint → walk to the next one
 *   { kind: 'complete'       }  searched the final waypoint → grant the content
 * Callers own location updates (task.dest is the waypoint) and, on 'complete',
 * calling the content's normal completion path with journey.payload.
 */
export function advanceJourneyPhase(task) {
  const j = task?.journey
  if (!j) return null
  if (j.phase !== 'search') {
    return { kind: 'search', next: journeyDwellTask(task.dest, j) }
  }
  const nextStep = j.step + 1
  if (nextStep >= j.steps.length) return { kind: 'complete' }
  const next = journeyLegTask(j.steps[j.step], j.steps[nextStep], { ...j, step: nextStep, phase: 'travel' })
  // A vanished route (world data change mid-save) still finishes the journey rather
  // than stranding the task forever.
  return next ? { kind: 'leg', next } : { kind: 'complete' }
}

/**
 * The player teleported to `placeId` while a journey walking leg was underway:
 * re-plan the leg from the landing place. Landing on the waypoint itself skips
 * the whole walk — the search starts immediately. Returns { task, searching },
 * or null when the teleport can't serve the journey: a search in progress is
 * bound to its waypoint (callers should block the cast and tell the player to
 * finish or abandon), and a landing place with no route to the waypoint can't
 * continue the trail.
 */
export function teleportIntoJourney(task, placeId) {
  const j = task?.journey
  if (!j || j.phase === 'search') return null
  if (placeId === task.dest) return { task: journeyDwellTask(placeId, j), searching: true }
  const leg = journeyLegTask(placeId, task.dest, j)
  return leg ? { task: leg, searching: false } : null
}

/**
 * Offline catch-up for a journey: walk legs and searches through `elapsedMs`,
 * chaining phases exactly as the live tick would. Never grants the content —
 * a finished journey is returned parked on its final search with 0 ticks left
 * (`completedPending: true`), and the App's next live tick completes it with the
 * full toast/reward path. Returns { task, location, completedPending, msRemaining }:
 * `location` is the last waypoint reached (null if still on the first leg);
 * `msRemaining` is the unspent elapsed time when the journey finished early
 * (0 unless completedPending) — the credit skip uses it to chain further clues.
 */
export function advanceJourneyOffline(task, elapsedMs) {
  let cur = task
  let ms = Math.max(0, Number(elapsedMs) || 0)
  let location = null
  for (;;) {
    const remainingMs = (cur.ticksRemaining ?? cur.totalTicks ?? 0) * JOURNEY_TICK_MS
    const adv = advanceTravel(cur, ms)
    if (!adv.arrived) return { task: adv.task, location, completedPending: false, msRemaining: 0 }
    ms -= remainingMs
    const step = advanceJourneyPhase(adv.task)
    if (!step || step.kind === 'complete') {
      location = adv.task.dest
      return { task: { ...adv.task, ticksRemaining: 0 }, location, completedPending: true, msRemaining: Math.max(0, ms) }
    }
    if (step.kind === 'search') location = adv.task.dest
    cur = step.next
    if (ms <= 0) return { task: cur, location, completedPending: false, msRemaining: 0 }
  }
}

/** Banner/status strings for a journey task. */
export function journeyStatus(task) {
  const j = task?.journey
  if (!j) return null
  const stepNo = j.step + 1
  const total = j.steps.length
  const placeName = getPlace(task.dest)?.name || task.dest
  return {
    icon: j.icon || '🧭',
    name: j.name || (j.kind === 'clue' ? 'Clue trail' : 'Quest journey'),
    step: stepNo,
    steps: total,
    searching: j.phase === 'search',
    lead: j.phase === 'search' ? `Searching ${placeName}` : `Following the trail to ${placeName}`,
  }
}
