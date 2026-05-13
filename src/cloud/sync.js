// Cloud-save push/pull. Pushes are debounced to once per 60s per character.

import { api, getToken, getCharacterId, setLocalCharacterId, SAVE_REVISION_EVENT } from './api.js'
import { buildSavePayloadFromSnapshot, applySavePayload } from '../db/saveload.js'
import { withTimeout } from '../utils/helpers.js'
import { CRITICAL_SAVE_COALESCE_MS, CRITICAL_SAVE_REASONS, normaliseCriticalSaveReason } from './criticalSavePolicy.js'

const PUSH_DEBOUNCE_MS = 60_000
// Grace window for clock skew between this client and the cloud server when
// deciding whether the cloud copy is meaningfully newer than our last push.
const FRESHNESS_GRACE_MS = 5_000
// Hard cap for blocking boot/visibility-time cloud reads. A slow or hung
// endpoint must never trap the user on the loading screen or prevent the
// idle-result modal from appearing — we fall back to local state instead.
const CLOUD_READ_TIMEOUT_MS = 5_000
const ACTIVE_MATCH_RETRY_MS = 5_000
export const CLOUD_SAVE_STATUS_EVENT = 'pocketrpg:cloud-save-status'

let lastPushedAt = 0
let lastSaveRevision = 0
let pendingTimer = null
let pendingSnapshot = null
let pendingSaveOptions = {}
let inFlight = false
let criticalTimer = null
let pendingCriticalSnapshotSource = null
let pendingCriticalReasons = new Set()
let hasUnsyncedChanges = false

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

async function flushNow() {
  pendingTimer = null
  if (!canSync() || !pendingSnapshot) return
  if (inFlight) {
    // Reschedule a single retry once the in-flight push settles.
    schedulePush(pendingSnapshot, 1000)
    return
  }
  const snap = pendingSnapshot
  pendingSnapshot = null
  inFlight = true
  emitCloudSaveStatus('saving')
  try {
    const data = buildSavePayloadFromSnapshot(snap)
    const json = JSON.stringify(data)
    const res = await api.putSave(json, { ...pendingSaveOptions, saveRevision: lastSaveRevision })
    pendingSaveOptions = {}
    if (res?.updatedAt) lastPushedAt = res.updatedAt
    if (Number.isFinite(res?.save_revision)) lastSaveRevision = res.save_revision
    hasUnsyncedChanges = false
    emitCloudSaveStatus('saved', { updatedAt: res?.updatedAt || null })
    console.log('[PocketRPG] Cloud save pushed, size:', json.length)
  } catch (err) {
    // While a PvP match is active, /api/save intentionally returns:
    //   409 { error: 'character_in_active_match' }
    // Keep the latest snapshot queued and retry shortly after so we don't
    // spam warnings every minute and we resume syncing automatically on exit.
    if (err?.status === 409 && (err?.body?.error === 'character_in_active_match' || err?.message === 'character_in_active_match')) {
      emitSaveSyncActiveMatchConflict(err?.body?.match_id)
      pendingSnapshot = snap
      markUnsynced()
      schedulePush(snap, ACTIVE_MATCH_RETRY_MS)
      return
    }
    pendingSaveOptions = {}
    emitCloudSaveStatus('failed', { error: err?.message || 'cloud_save_failed' })
    console.warn('[PocketRPG] Cloud push failed:', err.message)
  } finally {
    inFlight = false
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
  schedulePush(snapshot)
}

// Public: bypass the debounce — used on tab-hide / page-unload so we don't
// lose a pending push.
export async function pushNow(snapshot) {
  if (!canSync()) return
  if (snapshot) pendingSnapshot = snapshot
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
  await flushNow()
}


function resolveSnapshotSource(source) {
  if (typeof source === 'function') return source()
  return source
}

export function requestCriticalPushSave(snapshotOrFactory, reason = 'critical') {
  if (!canSync()) return false
  if (!snapshotOrFactory) return false

  pendingCriticalSnapshotSource = snapshotOrFactory
  pendingCriticalReasons.add(normaliseCriticalSaveReason(reason))
  if (reason === CRITICAL_SAVE_REASONS.SKIP_HOUR) {
    pendingSaveOptions.creditsUsedIncrement = 1
  }
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
// Returns { applied, payload, updatedAt } or { applied: false }. Guarded by
// a timeout so a slow/hung endpoint can't trap the boot sequence on the
// "Loading…" screen — we fall back to the local IDB save in that case.
export async function pullSave() {
  if (!canSync()) return { applied: false }
  const res = await withTimeout(api.getSave(), CLOUD_READ_TIMEOUT_MS, null)
  if (!res || !res.save) return { applied: false }
  const { save_data, updatedAt, save_revision } = res.save
  if (Number.isFinite(save_revision)) lastSaveRevision = save_revision
  return { applied: false, payload: JSON.parse(save_data), updatedAt }
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
export async function applyCloudSave(payload, updatedAt) {
  await applySavePayload(payload, { restoreLocalIdleMirrors: false })
  if (updatedAt) lastPushedAt = updatedAt
  if (Number.isFinite(updatedAt) && Number.isFinite(lastSaveRevision) === false) lastSaveRevision = 0
  // IDB now holds this character's data — stamp ownership so the next boot
  // knows which character these rows belong to.
  const charId = getCharacterId()
  if (charId) setLocalCharacterId(charId)
}

// Reset cached state — call on logout / character switch.
export function resetSyncState() {
  lastPushedAt = 0
  lastSaveRevision = 0
  pendingSnapshot = null
  hasUnsyncedChanges = false
  pendingSaveOptions = {}
  pendingCriticalSnapshotSource = null
  pendingCriticalReasons.clear()
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
  if (criticalTimer) { clearTimeout(criticalTimer); criticalTimer = null }
}
