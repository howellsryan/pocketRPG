// Cloud-save push/pull. Pushes are debounced to once per 120s per character;
// durability between debounce windows comes from critical-save milestones
// (level-up / boss / quest / unlock) and the visibility/unload flush.

import { api, getToken, getCharacterId, setLocalCharacterId, SAVE_REVISION_EVENT } from './api.js'
import { buildSavePayloadFromSnapshot, applySavePayload } from '../db/saveload.js'
import { withTimeout } from '../utils/helpers.js'
import { CRITICAL_SAVE_COALESCE_MS, CRITICAL_SAVE_REASONS, normaliseCriticalSaveReason } from './criticalSavePolicy.js'

const PUSH_DEBOUNCE_MS = 120_000
// Engagement-aware idle throttle. The periodic autosave + activity heartbeat
// are crash-durability BACKSTOPS, not the durability mechanism: live progress
// is mirrored to IndexedDB/localStorage every tick, flushed to the cloud on
// tab-hide/unload, and — on a hard crash — recovered on next boot by idle
// catch-up from the server-stamped last_active_at (which moves atomically with
// the save blob). Genuine milestones (level-up, rare drop, boss/quest/unlock,
// slayer) still push immediately via the critical-save path. So an AFK
// foreground session running an idle grind does NOT need a write every ~2 min —
// it only needs an occasional backstop. We keep the responsive cadence while
// the player is actually interacting and stretch it to ~hourly once idle, which
// is the dominant lever on idle D1 write/read volume.
const ENGAGED_INTERACTION_WINDOW_MS = 90_000
const IDLE_PERIODIC_SAVE_INTERVAL_MS = 3_600_000 // ~1h
// Hard ceiling: once a session has gone this long with no human interaction it
// is an abandoned/forgotten tab. The periodic backstop stops emitting saves
// entirely so it stops hitting the server — live progress is reconstructable on
// return via idle catch-up (itself capped at 24h). Re-arms on the next
// interaction. Mirrors the server-side IDLE_WRITE_CEILING_MS / MAX_OFFLINE_MS.
const IDLE_WRITE_CEILING_MS = 24 * 60 * 60 * 1000
// Last time the player interacted with the page (pointer/key/touch, or a
// tab-foreground transition). Seeded to "now" so a fresh session starts engaged.
let lastInteractionAt = Date.now()
// Grace window for clock skew between this client and the cloud server when
// deciding whether the cloud copy is meaningfully newer than our last push.
const FRESHNESS_GRACE_MS = 5_000
// Hard cap for blocking boot/visibility-time cloud reads. A slow or hung
// endpoint must never trap the user on the loading screen or prevent the
// idle-result modal from appearing — we fall back to local state instead.
const CLOUD_READ_TIMEOUT_MS = 5_000
const ACTIVE_MATCH_RETRY_MS = 5_000
// How many consecutive failed pushes we tolerate before declaring the save
// "blocked" — at which point the UI hard-stops play and forces the player to
// retry or log out, rather than letting them keep playing on top of progress
// that is silently failing to persist.
const SAVE_FAILURE_BLOCK_THRESHOLD = 3
// Backoff between automatic retries of a failed push. Scales with the failure
// streak and is capped so a long outage retries on a steady cadence.
const SAVE_RETRY_BACKOFF_MS = 3_000
const MAX_RETRY_BACKOFF_MS = 30_000
export const CLOUD_SAVE_STATUS_EVENT = 'pocketrpg:cloud-save-status'

let lastPushedAt = 0
let lastSaveRevision = 0
// Serialized content of the last *successful* push, with the volatile
// top-level `timestamp` normalized out. The 60s cadence skips the network
// round-trip entirely when the snapshot hasn't actually changed (pure idle /
// AFK tabs), cutting daily DB writes without weakening durability — content
// equal to the last successful push is already on the server.
let lastPushedContentKey = null

// Volatile fields on settings.activeTask that the activity runner mutates on
// EVERY 600ms tick (per-action countdown + live session tallies). They carry no
// durable state the cloud needs — XP/coins/items already live in stats/inventory/
// bank — but if they're left in the dirty-check key, a task merely counting down
// (or an AFK tab with a task running) looks "changed" every tick and defeats the
// no-op skip, so each periodic/heartbeat save writes even when nothing real
// progressed. Neutralise them so only genuine progress (or a task identity
// change) counts as a content change. Task IDENTITY (type/skill/action/…) is
// preserved, so starting/stopping/switching a task still triggers a save.
const VOLATILE_ACTIVE_TASK_FIELDS = ['ticksRemaining', 'pendingTicks', 'totalTicks', 'session']

function normaliseActiveTaskForKey(settings) {
  const activeTask = settings?.activeTask
  if (!activeTask || typeof activeTask !== 'object') return settings
  const trimmed = { ...activeTask }
  for (const f of VOLATILE_ACTIVE_TASK_FIELDS) delete trimmed[f]
  return { ...settings, activeTask: trimmed }
}

// Exported for tests: timestamp-insensitive content key for a save payload.
export function saveContentKey(payload) {
  return JSON.stringify({ ...payload, timestamp: 0, settings: normaliseActiveTaskForKey(payload?.settings) })
}
let pendingTimer = null
let pendingSnapshot = null
let pendingSaveOptions = {}
let inFlight = false
// Promise for the push currently on the wire. Callers (pushNow, re-entrant
// flushNow) await this so we never abandon a save while the server is still
// responding — the skip-hour durability gate depends on this WAIT.
let inFlightPromise = null
// Consecutive failed pushes since the last success. Drives escalation from a
// soft 'failed' badge to a hard 'blocked' modal.
let consecutiveFailures = 0
let criticalTimer = null
let pendingCriticalSnapshotSource = null
let pendingCriticalReasons = new Set()
let hasUnsyncedChanges = false
// While a critical, all-or-nothing operation (e.g. a paid skip) is mid-flight,
// the game is frozen and we MUST NOT let the autosave cadence or critical-save
// milestones fire competing writes that race the operation's own authoritative
// push — that race is what drove the intermittent save_revision_conflict. The
// operation calls pushNow() directly, which deliberately bypasses this gate.
let savesSuspended = false
// Set once the server rejects a push with save_revision_conflict — our local
// state has diverged from the authoritative cloud copy. We stop pushing the
// stale snapshot (it only repeats the 409) and let the app roll back to the
// cloud copy. Cleared on resetSyncState / a fresh page boot.
let conflictPending = false

if (typeof window !== 'undefined') {
  window.addEventListener(SAVE_REVISION_EVENT, (event) => {
    const revision = Number(event?.detail?.saveRevision)
    if (Number.isFinite(revision) && revision >= 0) {
      lastSaveRevision = revision
    }
  })
}

function emitCloudSaveStatus(status, detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CLOUD_SAVE_STATUS_EVENT, {
    detail: {
      status,
      ...detail,
    },
  }))
}

function markUnsynced() {
  hasUnsyncedChanges = true
  emitCloudSaveStatus('pending')
  emitCloudSaveStatus('out_of_sync')
}

function emitSaveSyncActiveMatchConflict(matchId) {
  const parsed = Number(matchId)
  if (!Number.isFinite(parsed) || parsed <= 0 || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('pocketrpg:pvp-active-match', { detail: { matchId: parsed } }))
}

function isPvpSaveSyncBlocked() {
  try {
    return localStorage.getItem('pocketrpg_pvp_sync_block') === '1'
  } catch {
    return false
  }
}

function canSync() {
  return !!getToken() && !!getCharacterId() && !isPvpSaveSyncBlocked()
}

// Perform the actual network push for the current pendingSnapshot. The caller
// guarantees no other push is in flight. Returns true if the save landed.
async function performPush() {
  const snap = pendingSnapshot
  pendingSnapshot = null
  inFlight = true
  emitCloudSaveStatus('saving')
  try {
    const data = buildSavePayloadFromSnapshot(snap)
    const json = JSON.stringify(data)
    const contentKey = saveContentKey(data)
    // Dirty check: identical to the last successful push → nothing to do, so we
    // never hit the network (and the server therefore never writes). The one
    // exception is a `touch` push (PvP lobby): the match-create guard refuses a
    // save whose updated_at is >15s old, so a lobby-sitting player whose save
    // content hasn't changed still needs the server to bump updated_at. Those
    // pushes skip the dirty check and the server bumps updated_at without
    // rewriting the blob (see save.js no-op branch).
    const wantsTouch = pendingSaveOptions.touch === true
    if (!wantsTouch && contentKey === lastPushedContentKey) {
      pendingSaveOptions = {}
      hasUnsyncedChanges = false
      consecutiveFailures = 0
      emitCloudSaveStatus('saved', { updatedAt: lastPushedAt || null, skipped: true })
      return true
    }
    // Tell the server whether the player is genuinely engaged (interacted
    // recently). Idle backstop writes carry interactive:false so the server can
    // enforce the idle write ceiling; engaged/manual saves omit it (default
    // interactive) and always persist + refresh the freshness stamp.
    const interactive = isEngaged()
    const res = await api.putSave(json, { ...pendingSaveOptions, saveRevision: lastSaveRevision, interactive })
    pendingSaveOptions = {}
    if (res?.updatedAt) lastPushedAt = res.updatedAt
    if (Number.isFinite(res?.save_revision)) lastSaveRevision = res.save_revision
    lastPushedContentKey = contentKey
    hasUnsyncedChanges = false
    consecutiveFailures = 0
    emitCloudSaveStatus('saved', { updatedAt: res?.updatedAt || null })
    console.log('[PocketRPG] Cloud save pushed, size:', json.length)
    return true
  } catch (err) {
    // While a PvP match is active, /api/save intentionally returns:
    //   409 { error: 'character_in_active_match' }
    // Keep the latest snapshot queued and retry shortly after so we don't
    // spam warnings every minute and we resume syncing automatically on exit.
    // This is an expected, transient lock — it must NOT count toward the
    // failure streak that escalates to the blocking modal.
    if (err?.status === 409 && (err?.body?.error === 'character_in_active_match' || err?.message === 'character_in_active_match')) {
      emitSaveSyncActiveMatchConflict(err?.body?.match_id)
      pendingSnapshot = snap
      markUnsynced()
      schedulePush(snap, ACTIVE_MATCH_RETRY_MS)
      return false
    }
    // save_revision_conflict: our local state diverged from the server's
    // authoritative copy (we got into a bad state — typically progress applied
    // faster than a prior save round-tripped). Re-pushing the same stale
    // snapshot only repeats the 409, so we DROP the pending push, flag the
    // conflict, and emit 'conflict' so the app rolls back to the cloud copy
    // (a fresh GET on the next boot). This is NOT a transient network failure,
    // so it must NOT count toward the failure streak that escalates to the
    // blocking modal, and we must NOT schedule a retry.
    if (err?.status === 409 && (err?.body?.code === 'SAVE_REVISION_CONFLICT' || err?.body?.error === 'save_revision_conflict' || err?.message === 'save_revision_conflict')) {
      conflictPending = true
      pendingSnapshot = null
      pendingSaveOptions = {}
      hasUnsyncedChanges = false
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
      emitCloudSaveStatus('conflict', { currentRevision: Number(err?.body?.current_revision) })
      return false
    }
    pendingSaveOptions = {}
    // Genuine failure: keep the snapshot queued so the retry re-sends THIS
    // state (never silently drop progress) and track the streak. Once we've
    // failed enough times in a row we escalate to 'blocked', which the UI
    // turns into a hard stop with Retry / Logout.
    pendingSnapshot = snap
    hasUnsyncedChanges = true
    consecutiveFailures++
    const backoff = Math.min(SAVE_RETRY_BACKOFF_MS * consecutiveFailures, MAX_RETRY_BACKOFF_MS)
    console.warn(`[PocketRPG] Cloud push failed (attempt ${consecutiveFailures}):`, err.message)
    if (consecutiveFailures >= SAVE_FAILURE_BLOCK_THRESHOLD) {
      emitCloudSaveStatus('blocked', { error: err?.message || 'cloud_save_failed', failures: consecutiveFailures })
    } else {
      emitCloudSaveStatus('failed', { error: err?.message || 'cloud_save_failed' })
    }
    // Keep retrying in the background regardless of state — if the network
    // recovers, the next success emits 'saved' and the UI lifts the block.
    schedulePush(snap, backoff)
    return false
  } finally {
    inFlight = false
  }
}

async function flushNow() {
  pendingTimer = null
  if (!canSync()) return false
  if (inFlight) {
    // A push is already on the wire. Wait for it to settle rather than bail.
    if (inFlightPromise) { try { await inFlightPromise } catch { /* handled below */ } }
    // If newer data is queued and nothing is scheduled to flush it, push now.
    // A failed push restores its snapshot AND schedules a backoff retry (which
    // sets pendingTimer), so a pending timer means "leave it to the backoff" —
    // don't tight-loop and bypass it.
    if (pendingSnapshot && !inFlight && !pendingTimer) return await flushNow()
    return !hasUnsyncedChanges
  }
  if (!pendingSnapshot) return !hasUnsyncedChanges
  inFlightPromise = performPush()
  try {
    return await inFlightPromise
  } finally {
    inFlightPromise = null
  }
}

function schedulePush(snapshot, delay = PUSH_DEBOUNCE_MS) {
  pendingSnapshot = snapshot
  markUnsynced()
  if (pendingTimer) return
  pendingTimer = setTimeout(flushNow, delay)
}

// Public: schedule a debounced push (called from the 60s tick + idle modal events).
export function schedulePushSave(snapshot) {
  if (!canSync()) return
  if (savesSuspended || conflictPending) return
  schedulePush(snapshot)
}

// Public: record that the player just interacted (pointer/key/touch/foreground).
// Drives the engaged-vs-idle decision in schedulePeriodicSave. Exported for the
// app to forward synthetic interactions if needed; the listeners below cover the
// common cases automatically.
export function noteUserInteraction(at = Date.now()) {
  lastInteractionAt = at
}

function isEngaged(now = Date.now()) {
  return now - lastInteractionAt < ENGAGED_INTERACTION_WINDOW_MS
}

// Public: engagement-aware periodic/heartbeat backstop save. Called on the
// fixed-interval autosave tick and the activity heartbeat. While the player is
// actively interacting it behaves like schedulePushSave (responsive 120s
// debounce). Once the session is idle/AFK it only schedules a push after
// IDLE_PERIODIC_SAVE_INTERVAL_MS has elapsed since the last *successful* write —
// so an idle grind writes at most ~hourly instead of every ~2 min. lastPushedAt
// advances on every successful push (including critical-milestone saves), so an
// idle session that keeps levelling naturally coalesces its backstop with those.
export function schedulePeriodicSave(snapshot) {
  if (!canSync()) return
  if (savesSuspended || conflictPending) return
  const now = Date.now()
  // Phase 1 hard ceiling: an abandoned tab stops emitting periodic saves
  // altogether (the real lever on stale-tab request spam). Re-arms when the
  // player next interacts.
  if (now - lastInteractionAt > IDLE_WRITE_CEILING_MS) return
  if (!isEngaged(now)) {
    if (now - lastPushedAt < IDLE_PERIODIC_SAVE_INTERVAL_MS) return
  }
  schedulePush(snapshot)
}

// Treat genuine user input as engagement. Passive + capture so we observe it
// without interfering with the app's own handlers. A tab returning to the
// foreground also counts — the player is back and may be about to act.
if (typeof window !== 'undefined') {
  const markInteraction = () => { lastInteractionAt = Date.now() }
  for (const evt of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(evt, markInteraction, { passive: true, capture: true })
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) lastInteractionAt = Date.now()
    })
  }
}

// Public: freeze/unfreeze the background save cadence while a critical,
// all-or-nothing operation (paid skip) owns the single in-flight write. The
// operation drives its own durable save via pushNow(), which bypasses this gate.
export function suspendSaves() { savesSuspended = true }
export function resumeSaves() { savesSuspended = false }
// Public: has the server rejected our state as diverged? The app uses this to
// short-circuit its own save retry loops and trigger a cloud rollback.
export function isSaveConflict() { return conflictPending }
// Public: the app finished rolling back to the authoritative cloud copy
// (pullSave + applyCloudSave re-adopted the server's revision) — pushes may
// resume. Only the rollback path should call this.
export function clearSaveConflict() { conflictPending = false }

// Public: bypass the debounce — used on tab-hide / page-unload so we don't
// lose a pending push. Also drains any pending critical save inline, so
// callers that need "everything I've queued is on the server now" (e.g.
// the collection-log POST, which is gated server-side on item ownership)
// can await this and be confident the next request sees the new state.
// Returns true if the save landed on the server, false otherwise — callers
// that gate UI on durable persistence (e.g. the paid skip-hour flow) use
// this to decide whether to reveal rewards or keep retrying.
export async function pushNow(snapshot, options = {}) {
  if (!canSync()) return false
  // Once we've detected a divergence, stop pushing — the app is rolling back to
  // the cloud copy. Any further push would just repeat the 409.
  if (conflictPending) return false
  // `touch: true` (PvP lobby) forces the push through the dirty check so the
  // server can refresh updated_at even when the save content is unchanged.
  if (options && options.touch) pendingSaveOptions = { ...pendingSaveOptions, touch: true }
  // If a push is already on the wire, wait for it to settle before issuing our
  // own. We must never abandon the server mid-response — the paid skip-hour
  // flow awaits this to confirm progress is durable before revealing rewards.
  if (inFlight && inFlightPromise) { try { await inFlightPromise } catch { /* re-attempted below */ } }
  if (snapshot) pendingSnapshot = snapshot
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }

  // Resolve any pending critical-save snapshot synchronously and feed it
  // through the normal flushNow path. Without this, a critical push
  // queued moments before pushNow() would still be sitting on the
  // criticalTimer when we return.
  if (criticalTimer || pendingCriticalSnapshotSource) {
    if (criticalTimer) { clearTimeout(criticalTimer); criticalTimer = null }
    const source = pendingCriticalSnapshotSource
    pendingCriticalSnapshotSource = null
    pendingCriticalReasons.clear()
    const criticalSnapshot = resolveSnapshotSource(source)
    if (criticalSnapshot) pendingSnapshot = criticalSnapshot
  }

  return await flushNow()
}

// Public: force an immediate save attempt — used by the save-blocked modal's
// "Retry" button. Reuses pushNow (which waits for any in-flight push), so a
// success lifts the block (emits 'saved') and a failure keeps it up.
export async function retrySaveNow(snapshot) {
  return await pushNow(snapshot)
}


function resolveSnapshotSource(source) {
  if (typeof source === 'function') return source()
  return source
}

export function requestCriticalPushSave(snapshotOrFactory, reason = 'critical') {
  if (!canSync()) return false
  if (savesSuspended || conflictPending) return false
  if (!snapshotOrFactory) return false

  pendingCriticalSnapshotSource = snapshotOrFactory
  pendingCriticalReasons.add(normaliseCriticalSaveReason(reason))
  // Credit consumption is now debited server-side by /api/skip-hour and
  // /api/slayer/skip — see Step 1 of the production-readiness rollout.
  // The client no longer self-reports credits_used_increment.
  markUnsynced()

  // Critical milestones should not wait behind the normal 60s autosave timer.
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }

  if (criticalTimer) return true

  criticalTimer = setTimeout(() => {
    criticalTimer = null
    const source = pendingCriticalSnapshotSource
    const reasons = [...pendingCriticalReasons]
    pendingCriticalSnapshotSource = null
    pendingCriticalReasons.clear()

    const snapshot = resolveSnapshotSource(source)
    if (!snapshot) return

    void pushNow(snapshot).catch(err => {
      console.warn('[PocketRPG] Critical cloud save failed:', err?.message || err, { reasons })
    })
  }, CRITICAL_SAVE_COALESCE_MS)

  return true
}

// Public: pull the cloud save for the selected character.
// Returns { applied, payload, updatedAt, readFailed }. Guarded by a timeout so
// a slow/hung endpoint can't trap the boot sequence on the "Loading…" screen.
//
// `readFailed` distinguishes two very different no-payload outcomes that the
// caller MUST treat differently:
//   • readFailed: true  — the read timed out or errored. We do NOT know
//     whether a save exists. Callers must never treat this as "no save" and
//     overwrite the cloud with a fresh character (that is how a transient
//     network blip used to wipe a live account back to level 3).
//   • readFailed: false — the server authoritatively answered and there is no
//     save row yet. Safe to initialise a new game.
// `withTimeout` resolves to the sentinel on BOTH timeout and rejection, so a
// sentinel return unambiguously means the read did not succeed.
export async function pullSave() {
  if (!canSync()) return { applied: false, readFailed: true }
  const READ_FAILED = Symbol('read_failed')
  const res = await withTimeout(api.getSave(), CLOUD_READ_TIMEOUT_MS, READ_FAILED)
  if (res === READ_FAILED) return { applied: false, readFailed: true }
  if (!res || !res.save) return { applied: false, readFailed: false }
  const { save_data, updatedAt, save_revision } = res.save
  if (Number.isFinite(save_revision)) lastSaveRevision = save_revision
  return { applied: false, payload: JSON.parse(save_data), updatedAt, readFailed: false }
}

// Public: check if the cloud copy is meaningfully newer than the last save we
// pushed/applied. Used by the visibility handler before running idle simulation
// — if another concurrent session has saved while this tab was hidden, we want
// to take that copy instead of overwriting it with stale local idle results.
// Returns the cloud payload to apply, or null if local is up-to-date. Timed
// out so a hung request can't block the idle-result modal from showing.
export async function checkCloudNewer() {
  if (!canSync()) return null
  const res = await withTimeout(api.getSave(), CLOUD_READ_TIMEOUT_MS, null)
  if (!res || !res.save) return null
  const { save_data, updatedAt, save_revision } = res.save
  if (Number.isFinite(save_revision)) lastSaveRevision = save_revision
  if (updatedAt <= lastPushedAt + FRESHNESS_GRACE_MS) return null
  return { payload: JSON.parse(save_data), updatedAt }
}

// Public: apply a previously-pulled cloud save to IDB. Caller decides whether
// to do this based on conflict-resolution UX.
export async function applyCloudSave(payload, updatedAt, saveRevision) {
  await applySavePayload(payload, { restoreLocalIdleMirrors: false })
  if (updatedAt) lastPushedAt = updatedAt
  // We just adopted the server's copy, so its content is already durably stored.
  // Seed the dirty-check key with it: the next autosave / screen-change push of
  // unchanged state is then recognised as a no-op CLIENT-side and never hits the
  // network — closing the gap where the first push after a boot pull or a
  // server-authoritative save would otherwise reach the server and make it write
  // updated_at for nothing.
  try { lastPushedContentKey = saveContentKey(payload) } catch { lastPushedContentKey = null }
  // When the server hands back its authoritative revision (e.g. an action
  // completion / skip that wrote the save server-side), adopt it. Otherwise the
  // next client save would push a stale save_revision and be rejected 409.
  if (Number.isFinite(saveRevision)) lastSaveRevision = saveRevision
  else if (Number.isFinite(updatedAt) && Number.isFinite(lastSaveRevision) === false) lastSaveRevision = 0
  // IDB now holds this character's data — stamp ownership so the next boot
  // knows which character these rows belong to.
  const charId = getCharacterId()
  if (charId) setLocalCharacterId(charId)
}

// Reset cached state — call on logout / character switch.
export function resetSyncState() {
  lastPushedAt = 0
  lastSaveRevision = 0
  lastPushedContentKey = null
  lastInteractionAt = Date.now()
  pendingSnapshot = null
  hasUnsyncedChanges = false
  consecutiveFailures = 0
  inFlightPromise = null
  pendingSaveOptions = {}
  savesSuspended = false
  conflictPending = false
  pendingCriticalSnapshotSource = null
  pendingCriticalReasons.clear()
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
  if (criticalTimer) { clearTimeout(criticalTimer); criticalTimer = null }
}
