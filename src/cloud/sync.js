// Cloud-save push/pull. Pushes are debounced to once per 60s per character
// and skipped entirely when the encoded save hasn't changed since the last
// successful push.

import { api, getToken, getCharacterId } from './api.js'
import { encodeSaveData, buildSavePayloadFromState, applySavePayload, decodeSaveBase64 } from '../db/saveload.js'

const PUSH_DEBOUNCE_MS = 60_000

let lastPushedHash = null
let pendingTimer = null
let pendingSnapshot = null
let inFlight = false

function canSync() {
  return !!getToken() && !!getCharacterId()
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
  try {
    const data = buildSavePayloadFromState(snap.player, snap.stats, snap.inventory, snap.bank, snap.equipment)
    const { base64, hash } = encodeSaveData(data)
    if (hash === lastPushedHash) return
    await api.putSave(base64, hash)
    lastPushedHash = hash
    console.log('[PocketRPG] Cloud save pushed, size:', base64.length)
  } catch (err) {
    console.warn('[PocketRPG] Cloud push failed:', err.message)
  } finally {
    inFlight = false
  }
}

function schedulePush(snapshot, delay = PUSH_DEBOUNCE_MS) {
  pendingSnapshot = snapshot
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

// Public: pull the cloud save for the selected character.
// Returns { applied, payload, base64, updatedAt } or { applied: false, ... }.
export async function pullSave() {
  if (!canSync()) return { applied: false }
  const res = await api.getSave()
  if (!res || !res.save) return { applied: false }
  const { base64, updatedAt } = res.save
  const { data } = decodeSaveBase64(base64)
  return { applied: false, payload: data, base64, updatedAt }
}

// Public: apply a previously-pulled cloud save to IDB. Caller decides whether
// to do this based on conflict-resolution UX.
export async function applyCloudSave(payload, base64) {
  await applySavePayload(payload)
  // Mark the just-applied save as the last-pushed hash so we don't immediately
  // re-upload identical bytes.
  const { hash } = decodeSaveBase64(base64)
  lastPushedHash = hash
}

// Reset cached state — call on logout / character switch.
export function resetSyncState() {
  lastPushedHash = null
  pendingSnapshot = null
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
}
