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

import { api, getToken, getCharacterId } from './api.js'
import { withTimeout } from '../utils/helpers.js'

// Hard cap for the blocking boot-time idle fetch. If D1 is slow / the table
// doesn't exist yet / the Pages Function hangs, we don't want to trap the
// user on the loading screen — fall back to the localStorage mirror instead.
const FETCH_TIMEOUT_MS = 3_000

// Identity of the last task successfully pushed. setActiveTask fires on every
// task (re)start — including the per-kill "Fight again" restart of the SAME
// monster and re-tapping the same skilling action — and each push is a D1
// write to character_idle_state. When the task identity hasn't changed the
// row already holds it, and /api/save stamps last_active_at + active_task on
// every real save anyway, so a same-identity push buys nothing. Dedupe here.
let lastPushedTaskIdentity = null

// Fields the runner/screens rewrite per tick or per action (countdown +
// session tallies). They're irrelevant to which task the idle engine should
// resume, so they're excluded from the identity. Mirrors the volatile-field
// list in src/cloud/sync.js saveContentKey.
const VOLATILE_TASK_FIELDS = ['ticksRemaining', 'pendingTicks', 'totalTicks', 'session', 'justCompleted']

export function taskIdentityKey(task) {
  if (!task || typeof task !== 'object') return 'none'
  const trimmed = { ...task }
  for (const f of VOLATILE_TASK_FIELDS) delete trimmed[f]
  try { return JSON.stringify(trimmed) } catch { return null }
}

// True when we have both a session token and a selected character — the only
// case where the cloud idle row is meaningful. Offline-mode callers always
// get `false` and skip the D1 path entirely.
function canUseCloud() {
  return !!getToken() && !!getCharacterId()
}

// A boot-time /api/bootstrap response already carries this character's idle
// row, but `fetchIdleState` is called from inside `loadGame`, which has five
// call sites — so the answer is parked here for the next read instead of being
// threaded through all of them.
//
// Two bounds, and BOTH are needed. Single use stops the same snapshot being
// replayed; the age check stops one being read long after the boot that took
// it. They are different failure modes: the brand-new-character branch of
// initCloudAndSave returns before loadGame ever runs, leaving a prime set with
// nothing to consume it, and the next reader is whatever calls loadGame next —
// a world return, a save-conflict resolution — where the row has moved on and
// serverNow is minutes stale. A stale prime is dropped AND cleared, so the
// caller falls through to the network read it would have made anyway.
// `resetIdleStateSync` clears it outright so a character switch can never read
// the previous character's row.
const IDLE_PRIME_MAX_AGE_MS = 30_000

let primedIdleState = null
let primedIdleAt = 0

export function primeIdleState(state) {
  primedIdleState = state && typeof state === 'object' ? state : null
  primedIdleAt = primedIdleState ? Date.now() : 0
}

// Read the authoritative idle state from D1.
// Returns { lastActiveAt, activeTask, serverNow } or null when no row exists /
// offline / the request times out. Always resolves within FETCH_TIMEOUT_MS so
// the boot loader can't get trapped here. `serverNow` is the worker's
// Date.now() at response time — callers should prefer it over the local
// wall clock when computing elapsed idle time, since the local clock is
// user-manipulable.
export async function fetchIdleState() {
  if (!canUseCloud()) return null
  if (primedIdleState) {
    const primed = primedIdleState
    const fresh = Date.now() - primedIdleAt <= IDLE_PRIME_MAX_AGE_MS
    primedIdleState = null
    primedIdleAt = 0
    if (fresh) return primed
  }
  const res = await withTimeout(api.getIdle(), FETCH_TIMEOUT_MS, null)
  if (!res) return null
  const serverNow = typeof res.serverNow === 'number' ? res.serverNow : null
  if (!res.idle) return serverNow ? { lastActiveAt: null, activeTask: null, serverNow } : null
  return {
    lastActiveAt: res.idle.lastActiveAt,
    activeTask: res.idle.activeTask ?? null,
    serverNow,
  }
}

// Write the current active task to D1. Server stamps last_active_at with its
// own clock — the `task` argument just controls what task JSON is stored.
// Pass `null` when the player has no active task (e.g. stopped / navigated away).
export async function pushIdleState(task) {
  if (!canUseCloud()) return
  // Same task identity as the last successful push → the server row already
  // says this; skip the network round-trip and the D1 write. Restarting the
  // same fight/action after every kill was one of the top two write-volume
  // sources. A changed identity (start/stop/switch) still pushes immediately.
  const identity = taskIdentityKey(task)
  if (identity !== null && identity === lastPushedTaskIdentity) return
  try {
    await api.putIdle(task ?? null)
    lastPushedTaskIdentity = identity
  } catch (err) {
    console.warn('[PocketRPG] Idle push failed:', err.message)
  }
}

// Reset in-memory dedupe state — call on logout / character switch.
export function resetIdleStateSync() {
  lastPushedTaskIdentity = null
  primedIdleState = null
  primedIdleAt = 0
}
