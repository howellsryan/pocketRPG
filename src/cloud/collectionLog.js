// Buffered client for the server-side collection log.
//
// Drop hooks fire frequently (every monster death) so we batch records into a
// short window before posting. Server validates every entry against the
// bundled collectionLog.json — items obtained via store/PvP/console are
// silently rejected because no PvE source maps to them.

import { api, getToken, getCharacterId } from './api.js'
import { pushNow } from './sync.js'
import { isSlotObtained } from '../engine/collectionLog.js'

const FLUSH_DELAY_MS = 500
const MAX_BUFFER = 64
const SERVER_AUTHORITATIVE_SOURCES = new Set(['monsters', 'raids'])

let buffer = []
let timer = null
let collectionLogListeners = new Set()
let collectionLogSlotListeners = new Set()
let cachedEntries = null    // Set<string> "type:source:item"
let cachedTotal = null
let isFetching = false

function entryKey(e) {
  return `${e.sourceType}:${e.sourceId}:${e.itemId}`
}

export function getCachedEntries() {
  return cachedEntries
}

export function getCachedTotal() {
  return cachedTotal
}

export function subscribe(fn) {
  collectionLogListeners.add(fn)
  return () => collectionLogListeners.delete(fn)
}

// Fires once per fresh slot completion (i.e. transitions from "unobtained" to
// "obtained" in the user's view). Used by the UI to surface a toast.
export function onCollectionLogSlotComplete(fn) {
  collectionLogSlotListeners.add(fn)
  return () => collectionLogSlotListeners.delete(fn)
}

function notify() {
  for (const fn of collectionLogListeners) {
    try { fn({ entries: cachedEntries, total: cachedTotal }) } catch (err) { console.warn('[collectionLog] listener error', err) }
  }
}

function notifySlotComplete(entry) {
  for (const fn of collectionLogSlotListeners) {
    try { fn(entry) } catch (err) { console.warn('[collectionLog] slot listener error', err) }
  }
}

export async function fetchCollectionLog({ force = false } = {}) {
  if (!getToken() || !getCharacterId()) return null
  if (cachedEntries && !force) return { entries: cachedEntries, total: cachedTotal }
  if (isFetching) return null
  isFetching = true
  try {
    const res = await api.getCollectionLog()
    const set = new Set()
    for (const e of (res?.entries || [])) {
      if (e?.itemId && e?.sourceType && e?.sourceId) set.add(entryKey(e))
    }
    cachedEntries = set
    cachedTotal = typeof res?.total === 'number' ? res.total : cachedTotal
    notify()
    return { entries: cachedEntries, total: cachedTotal }
  } catch (err) {
    if (err?.status !== 401) console.warn('[collectionLog] fetch failed', err)
    return null
  } finally {
    isFetching = false
  }
}


export function applyServerCollectionLogEntries(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) return
  if (!cachedEntries) cachedEntries = new Set()
  let changed = false
  for (const e of entries) {
    const itemId = typeof e?.itemId === 'string' ? e.itemId : null
    const sourceType = typeof e?.sourceType === 'string' ? e.sourceType : null
    const sourceId = typeof e?.sourceId === 'string' ? e.sourceId : null
    if (!itemId || !sourceType || !sourceId) continue
    const key = `${sourceType}:${sourceId}:${itemId}`
    if (cachedEntries.has(key)) continue
    cachedEntries.add(key)
    changed = true
    notifySlotComplete({ itemId, sourceType, sourceId })
  }
  if (changed) notify()
}

export function clearCollectionLogCache() {
  cachedEntries = null
  cachedTotal = null
  buffer = []
  if (timer) { clearTimeout(timer); timer = null }
  notify()
}

async function flush() {
  timer = null
  if (buffer.length === 0) return
  if (!getToken() || !getCharacterId()) {
    // Without auth we can't post — drop the buffer; the next live hit will
    // re-record. We never persist locally without a logged-in cloud session.
    buffer = []
    return
  }
  // Drain any pending save first. The server's collection-log handler
  // requires the player to currently own the claimed item (server-side
  // ownership check, see functions/api/collection-log.js), and a client-
  // authoritative reward flow (e.g. minigame completion) may have only
  // queued the save push 500ms ago. Without this drain the POST would
  // race the save and the server's stored save would still lack the
  // item.
  try { await pushNow() } catch { /* best-effort — proceed regardless */ }
  const batch = buffer.splice(0, MAX_BUFFER)
  try {
    await api.postCollectionLog(batch)
    if (cachedEntries) {
      for (const e of batch) cachedEntries.add(entryKey(e))
      notify()
    }
  } catch (err) {
    if (err?.status !== 401) console.warn('[collectionLog] post failed', err)
  }
  if (buffer.length > 0) scheduleFlush()
}

function scheduleFlush() {
  if (timer) return
  timer = setTimeout(() => { flush().catch(() => {}) }, FLUSH_DELAY_MS)
}

// Record a candidate drop. Server is source of truth; we still optimistically
// dedupe against the local cache so we don't spam the buffer with already-
// owned entries. Skips records whose slot is already visually obtained
// (covers the shared-item case where one source credits multiple slots).
export function recordCollectionLogDrop({ itemId, sourceType, sourceId }) {
  if (!itemId || !sourceType || !sourceId) return
  if (SERVER_AUTHORITATIVE_SOURCES.has(sourceType)) return
  const key = `${sourceType}:${sourceId}:${itemId}`
  if (cachedEntries) {
    if (cachedEntries.has(key)) return
    if (isSlotObtained(cachedEntries, sourceType, sourceId, itemId)) return
  }
  // Avoid duplicate buffered entries within the same flush window.
  if (buffer.some(e => entryKey(e) === key)) return
  buffer.push({ itemId, sourceType, sourceId })
  // Fire the toast hook eagerly — server validation may still reject, but the
  // common case is a successful insert and waiting for the round-trip would
  // make the toast feel laggy after a kill.
  notifySlotComplete({ itemId, sourceType, sourceId })
  scheduleFlush()
}
