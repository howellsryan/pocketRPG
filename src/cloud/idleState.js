// Authoritative idle-state sync for D1.
//
// When online and signed in, the server row at /api/idle is the source of
// truth for:
//   - when the player was last active (server-stamped Date.now())
//   - what task they were doing (activeTask JSON)
//
// localStorage copies (pocketrpg_lastTick, pocketrpg_activeTask) stay in
// place as an offline-mode fallback and as a belt-and-braces backup if the
// D1 fetch fails. Reads prefer D1; writes go to both.

import { api, sendIdleBeacon, getToken, getCharacterId } from './api.js'

const HEARTBEAT_THROTTLE_MS = 5_000 // don't PUT more than once per 5s

let lastHeartbeatAt = 0
let heartbeatInFlight = false
let pendingHeartbeatTask = undefined // `undefined` = none pending, otherwise holds latest task

// True when we have both a session token and a selected character — the only
// case where the cloud idle row is meaningful. Offline-mode callers always
// get `false` and skip the D1 path entirely.
function canUseCloud() {
  return !!getToken() && !!getCharacterId()
}

// Read the authoritative idle state from D1.
// Returns { lastActiveAt, activeTask } or null when no row exists / offline.
export async function fetchIdleState() {
  if (!canUseCloud()) return null
  try {
    const res = await api.getIdle()
    if (!res || !res.idle) return null
    return { lastActiveAt: res.idle.lastActiveAt, activeTask: res.idle.activeTask ?? null }
  } catch (err) {
    console.warn('[PocketRPG] Idle fetch failed, falling back to local:', err.message)
    return null
  }
}

// Write the current active task to D1. Server stamps last_active_at with its
// own clock — the `task` argument just controls what task JSON is stored.
// Pass `null` when the player has no active task (e.g. stopped / navigated away).
export async function pushIdleState(task) {
  if (!canUseCloud()) return
  try {
    await api.putIdle(task ?? null)
    lastHeartbeatAt = Date.now()
  } catch (err) {
    console.warn('[PocketRPG] Idle push failed:', err.message)
  }
}

// Throttled heartbeat — called from the 30s tick. Skips the write if a
// successful write happened very recently (e.g. a setActiveTask-triggered
// push just landed) so we don't thrash the DB.
export async function heartbeatIdleState(task) {
  if (!canUseCloud()) return
  const now = Date.now()
  if (now - lastHeartbeatAt < HEARTBEAT_THROTTLE_MS) return
  if (heartbeatInFlight) {
    // Coalesce — the in-flight write will be followed by one more with the
    // latest task once it settles.
    pendingHeartbeatTask = task ?? null
    return
  }
  heartbeatInFlight = true
  try {
    await api.putIdle(task ?? null)
    lastHeartbeatAt = Date.now()
  } catch (err) {
    console.warn('[PocketRPG] Idle heartbeat failed:', err.message)
  } finally {
    heartbeatInFlight = false
    if (pendingHeartbeatTask !== undefined) {
      const queued = pendingHeartbeatTask
      pendingHeartbeatTask = undefined
      // Fire and forget; don't block the caller on the follow-up.
      heartbeatIdleState(queued)
    }
  }
}

// Tab-hide / beforeunload path — uses navigator.sendBeacon so the write
// survives even when the browser is about to kill the page.
export function beaconIdleState(task) {
  if (!canUseCloud()) return false
  return sendIdleBeacon(task ?? null)
}

// Reset in-memory throttle state — call on logout / character switch.
export function resetIdleStateSync() {
  lastHeartbeatAt = 0
  heartbeatInFlight = false
  pendingHeartbeatTask = undefined
}
