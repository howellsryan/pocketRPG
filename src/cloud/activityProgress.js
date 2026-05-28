/**
 * Per-activity progress ledger.
 *
 * Saves partial progress for background activities so switching to a
 * different activity does NOT wipe the previous one's progress.
 * Fixed-duration activities (quests, minigames, dungeoneering rewards)
 * record progressTicks so they can resume exactly where they left off.
 */

import { api, getToken, getCharacterId } from './api.js'

const ACTIVITY_PROGRESS_STORAGE_KEY = 'pocketrpg_activityProgress'
const ACTIVITY_PROGRESS_MAX_ENTRIES = 50
const ACTIVITY_PROGRESS_PUSH_THROTTLE_MS = 2_000

let activityProgressLedger = null
let activityProgressFlushTimer = null

function canUseCloudForActivityProgress() {
  return !!getToken() && !!getCharacterId()
}

function loadActivityProgressLocal() {
  if (activityProgressLedger !== null) return activityProgressLedger
  try { activityProgressLedger = JSON.parse(localStorage.getItem(ACTIVITY_PROGRESS_STORAGE_KEY) || '{}') } catch { activityProgressLedger = {} }
  return activityProgressLedger
}

function persistActivityProgressLocal(ledger) {
  activityProgressLedger = ledger
  try { localStorage.setItem(ACTIVITY_PROGRESS_STORAGE_KEY, JSON.stringify(ledger)) } catch {}
}

function scheduleActivityProgressPush() {
  if (activityProgressFlushTimer) clearTimeout(activityProgressFlushTimer)
  activityProgressFlushTimer = setTimeout(() => { activityProgressFlushTimer = null; void pushActivityProgressToServer() }, ACTIVITY_PROGRESS_PUSH_THROTTLE_MS)
}

async function pushActivityProgressToServer() {
  if (!canUseCloudForActivityProgress()) return
  try { await api.putActivityProgress(loadActivityProgressLocal()) } catch (err) {
    console.warn('[PocketRPG] Activity progress push failed:', err?.message || err)
  }
}

/** Save progress for one activity key (upsert). */
export function saveActivityProgress(activityKey, entry) {
  if (!activityKey || typeof activityKey !== 'string') return
  const ledger = { ...loadActivityProgressLocal(), [activityKey]: { ...entry, updatedAt: Date.now() } }
  // Evict oldest entries beyond the cap
  const keys = Object.keys(ledger)
  if (keys.length > ACTIVITY_PROGRESS_MAX_ENTRIES) {
    const sorted = keys.sort((a, b) => (ledger[a].updatedAt || 0) - (ledger[b].updatedAt || 0))
    for (const k of sorted.slice(0, keys.length - ACTIVITY_PROGRESS_MAX_ENTRIES)) delete ledger[k]
  }
  persistActivityProgressLocal(ledger)
  scheduleActivityProgressPush()
}

/** Retrieve progress for one activity key, or null if not found. */
export function getActivityProgress(activityKey) {
  if (!activityKey) return null
  return loadActivityProgressLocal()[activityKey] ?? null
}

/** Overwrite the local ledger from a server response (called on boot). */
export function hydrateActivityLedger(serverProgress) {
  if (!serverProgress || typeof serverProgress !== 'object') return
  persistActivityProgressLocal(serverProgress)
}

/** Clear progress for one activity key (called on completion). */
export function clearActivityProgress(activityKey) {
  if (!activityKey) return
  const ledger = loadActivityProgressLocal()
  if (!ledger[activityKey]) return
  delete ledger[activityKey]
  persistActivityProgressLocal(ledger)
  scheduleActivityProgressPush()
}

/** Fetch from server and hydrate the local ledger (call on boot). */
export async function fetchAndHydrateActivityProgress() {
  if (!canUseCloudForActivityProgress()) return
  try {
    const result = await api.getActivityProgress()
    if (result?.progress) hydrateActivityLedger(result.progress)
  } catch (err) {
    console.warn('[PocketRPG] Activity progress fetch failed:', err?.message || err)
  }
}

/** Reset in-memory state (call on logout / character switch). */
export function resetActivityProgressSync() {
  activityProgressLedger = null
  if (activityProgressFlushTimer) { clearTimeout(activityProgressFlushTimer); activityProgressFlushTimer = null }
}
