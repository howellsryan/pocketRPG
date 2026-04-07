import { openDB } from 'idb'

const DB_NAME = 'PocketRPG'
const DB_VERSION = 1

let dbInstance = null

/**
 * Get or create the database instance.
 * Handles stale connections (e.g. iOS Safari kills background tabs).
 */
export async function getDB() {
  // If we have an instance, do a quick health-check before returning it
  if (dbInstance) {
    try {
      // A lightweight read to confirm the connection is alive
      await dbInstance.get('settings', '__healthcheck__')
      return dbInstance
    } catch (e) {
      // Connection is dead — clear it and reconnect
      console.warn('[PocketRPG] DB connection stale, reconnecting...', e)
      try { dbInstance.close() } catch (_) {}
      dbInstance = null
    }
  }

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
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
    }
  })

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
