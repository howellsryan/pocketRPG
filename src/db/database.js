import { openDB } from 'idb'

const DB_NAME = 'PocketRPG'
const DB_VERSION = 1

// Hard caps so a wedged IndexedDB (locked by another tab, corrupt, or stuck
// mid-upgrade) can never trap the boot sequence on the loading screen — the
// op rejects and the caller's catch / boot watchdog takes over instead.
const HEALTHCHECK_TIMEOUT_MS = 2_000
const DB_OPEN_TIMEOUT_MS = 8_000

let dbInstance = null

// Reject if `promise` hasn't settled within `ms`. Unlike utils/withTimeout this
// rejects (rather than resolving to a fallback) so a stale/blocked connection
// is surfaced as an error the caller can react to.
function withDbTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`db_timeout_${label}`)), ms)
    promise.then(
      v => { clearTimeout(t); resolve(v) },
      e => { clearTimeout(t); reject(e) },
    )
  })
}

/**
 * Get or create the database instance.
 * Handles stale connections (e.g. iOS Safari kills background tabs).
 */
export async function getDB() {
  // If we have an instance, do a quick health-check before returning it
  if (dbInstance) {
    try {
      // A lightweight read to confirm the connection is alive
      await withDbTimeout(dbInstance.get('settings', '__healthcheck__'), HEALTHCHECK_TIMEOUT_MS, 'healthcheck')
      return dbInstance
    } catch (e) {
      // Connection is dead — clear it and reconnect
      console.warn('[PocketRPG] DB connection stale, reconnecting...', e)
      try { dbInstance.close() } catch (_) {}
      dbInstance = null
    }
  }

  dbInstance = await withDbTimeout(openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Version 1: initial schema
      if (oldVersion < 1) {
        db.createObjectStore('player')       // key: 'profile'
        db.createObjectStore('stats')        // key: skill name
        db.createObjectStore('inventory')    // key: slot index
        db.createObjectStore('bank')         // key: item ID
        db.createObjectStore('equipment')    // key: slot name
        db.createObjectStore('settings')     // key: setting key
        db.createObjectStore('shortcuts')    // key: shortcut index
      }
    },
    blocked() {
      // Our open is waiting on an older connection in another tab to close.
      console.warn('[PocketRPG] DB open blocked by another tab/connection')
    },
    blocking() {
      // Another tab needs to upgrade and we're holding it open. Yield by
      // closing — the next getDB() here will reconnect at the new version.
      console.warn('[PocketRPG] Closing DB connection to unblock an upgrade in another tab')
      try { dbInstance?.close() } catch (_) {}
      dbInstance = null
    },
  }), DB_OPEN_TIMEOUT_MS, 'open')

  return dbInstance
}

/**
 * Force-close and clear the DB instance (call before re-opening after error)
 */
export function closeDB() {
  if (dbInstance) {
    try { dbInstance.close() } catch (_) {}
    dbInstance = null
  }
}

/**
 * Empty every object store in-place. Preferred over deleteDB() for "wipe local
 * save" flows: deleting the whole database is blocked by open connections in
 * OTHER tabs, and the follow-up open then queues behind that blocked delete and
 * hangs — which is exactly the multi-tab "stuck on loading" bug. Clearing stores
 * within our own connection doesn't block across same-version tabs.
 */
export async function clearAllStores() {
  const db = await getDB()
  const names = Array.from(db.objectStoreNames)
  if (!names.length) return
  const tx = db.transaction(names, 'readwrite')
  await Promise.all(names.map(name => tx.objectStore(name).clear()))
  await tx.done
}

/**
 * Check if a save exists
 */
export async function hasSave() {
  const db = await getDB()
  const profile = await db.get('player', 'profile')
  return !!profile
}

/**
 * Delete the entire database
 */
export async function deleteDB() {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
  await indexedDB.deleteDatabase(DB_NAME)
}

/**
 * Get all data from a store
 */
export async function getAllFromStore(storeName) {
  const db = await getDB()
  return db.getAll(storeName)
}

/**
 * Get all keys from a store
 */
export async function getAllKeysFromStore(storeName) {
  const db = await getDB()
  return db.getAllKeys(storeName)
}
