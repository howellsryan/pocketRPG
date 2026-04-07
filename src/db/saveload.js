import { getDB, deleteDB } from './database.js'
import { fnv1a } from '../utils/helpers.js'
import { ALL_SKILLS, INVENTORY_SIZE, EQUIPMENT_SLOTS } from '../utils/constants.js'

const SAVE_VERSION = 1

/**
 * Export entire game state to a downloadable file
 */
export async function exportSave() {
  const db = await getDB()

  const data = {
    version: SAVE_VERSION,
    timestamp: Date.now(),
    player: await db.get('player', 'profile'),
    stats: {},
    inventory: [],
    bank: {},
    equipment: {},
    settings: {}
  }

  // Stats
  for (const skill of ALL_SKILLS) {
    data.stats[skill] = await db.get('stats', skill)
  }

  // Inventory
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    data.inventory[i] = await db.get('inventory', i) || null
  }

  // Bank
  const bankKeys = await db.getAllKeys('bank')
  for (const key of bankKeys) {
    data.bank[key] = await db.get('bank', key)
  }

  // Equipment
  for (const slot of EQUIPMENT_SLOTS) {
    data.equipment[slot] = await db.get('equipment', slot) || null
  }

  // Settings
  const settingKeys = await db.getAllKeys('settings')
  for (const key of settingKeys) {
    data.settings[key] = await db.get('settings', key)
  }

  const json = JSON.stringify(data)
  const hash = fnv1a(json)
  const payload = JSON.stringify({ hash, data: json })
  const encoded = btoa(payload)

  // Download
  const blob = new Blob([encoded], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pocketrpg_${data.player?.name || 'save'}_${Date.now()}.pocketrpg`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Import a save file
 */
export async function importSave(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const decoded = atob(e.target.result)
        const { hash, data: json } = JSON.parse(decoded)

        // Verify integrity
        if (fnv1a(json) !== hash) {
          reject(new Error('Save file integrity check failed'))
          return
        }

        const data = JSON.parse(json)

        // Wipe and recreate
        await deleteDB()
        const { getDB: getNewDB } = await import('./database.js')
        const db = await getNewDB()

        // Restore player
        if (data.player) await db.put('player', data.player, 'profile')

        // Restore stats
        const statsTx = db.transaction('stats', 'readwrite')
        for (const [skill, val] of Object.entries(data.stats)) {
          if (val) statsTx.store.put(val, skill)
        }
        await statsTx.done

        // Restore inventory
        const invTx = db.transaction('inventory', 'readwrite')
        for (let i = 0; i < INVENTORY_SIZE; i++) {
          if (data.inventory[i]) invTx.store.put(data.inventory[i], i)
        }
        await invTx.done

        // Restore bank
        const bankTx = db.transaction('bank', 'readwrite')
        for (const [key, val] of Object.entries(data.bank)) {
          bankTx.store.put(val, key)
        }
        await bankTx.done

        // Restore equipment
        const eqTx = db.transaction('equipment', 'readwrite')
        for (const [slot, val] of Object.entries(data.equipment)) {
          if (val) eqTx.store.put(val, slot)
        }
        await eqTx.done

        // Restore settings
        const setTx = db.transaction('settings', 'readwrite')
        for (const [key, val] of Object.entries(data.settings)) {
          setTx.store.put(val, key)
        }
        await setTx.done

        resolve()
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsText(file)
  })
}

/**
 * Snapshot live game state to localStorage as a base64+hash backup.
 * Called every ~100 ticks (60s) from App tick loop.
 * Takes live state objects — no IDB read needed.
 */
export function snapshotToLocalStorage(player, stats, inventory, bank, equipment) {
  try {
    const data = {
      version: SAVE_VERSION,
      timestamp: Date.now(),
      player,
      stats,
      inventory,
      bank,
      equipment,
      settings: {}
    }
    // Capture active task and last tick from localStorage so idle engine
    // can calculate elapsed time after a full page close + reopen
    try { data.settings.activeTask = JSON.parse(localStorage.getItem('pocketrpg_activeTask')) } catch { data.settings.activeTask = null }
    data.settings.lastTick = parseInt(localStorage.getItem('pocketrpg_lastTick'), 10) || data.timestamp

    const json = JSON.stringify(data)
    const hash = fnv1a(json)
    const payload = JSON.stringify({ hash, data: json })
    // Use safe UTF-16→Latin1 encoding for btoa (TextEncoder round-trip)
    const encoded = btoa(unescape(encodeURIComponent(payload)))
    localStorage.setItem('pocketrpg_backup', encoded)
    console.log('[PocketRPG] Snapshot saved to localStorage, size:', encoded.length)
  } catch (err) {
    // localStorage may be full or unavailable — fail silently
    console.warn('[PocketRPG] Backup snapshot failed:', err)
  }
}

/**
 * Restore game state from localStorage backup into IndexedDB.
 * Returns the restored data object on success, or null if no backup / integrity fail.
 */
export async function restoreFromLocalStorage() {
  try {
    const encoded = localStorage.getItem('pocketrpg_backup')
    if (!encoded) return null

    const decoded = decodeURIComponent(escape(atob(encoded)))
    const { hash, data: json } = JSON.parse(decoded)

    if (fnv1a(json) !== hash) {
      console.warn('[PocketRPG] Backup integrity check failed — discarding')
      return null
    }

    const data = JSON.parse(json)

    // Wipe IDB and restore
    await deleteDB()
    const db = await getDB()

    if (data.player) await db.put('player', data.player, 'profile')

    const statsTx = db.transaction('stats', 'readwrite')
    for (const [skill, val] of Object.entries(data.stats || {})) {
      if (val) statsTx.store.put(val, skill)
    }
    await statsTx.done

    const invTx = db.transaction('inventory', 'readwrite')
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      if (data.inventory?.[i]) invTx.store.put(data.inventory[i], i)
    }
    await invTx.done

    const bankTx = db.transaction('bank', 'readwrite')
    for (const [key, val] of Object.entries(data.bank || {})) {
      bankTx.store.put(val, key)
    }
    await bankTx.done

    const eqTx = db.transaction('equipment', 'readwrite')
    for (const [slot, val] of Object.entries(data.equipment || {})) {
      if (val) eqTx.store.put(val, slot)
    }
    await eqTx.done

    // Restore settings to IDB if present
    if (data.settings) {
      const setTx = db.transaction('settings', 'readwrite')
      for (const [key, val] of Object.entries(data.settings)) {
        if (key !== 'activeTask' && key !== 'lastTick' && val != null) {
          setTx.store.put({ key, value: val }, key)
        }
      }
      await setTx.done
    }

    // ── CRITICAL: Restore localStorage keys so idle engine can calculate elapsed time ──
    // Use the snapshot's lastTick (or timestamp as fallback) so loadGame() sees
    // a valid elapsed-time window on the next startup.
    const savedLastTick = data.settings?.lastTick || data.timestamp
    if (savedLastTick) {
      localStorage.setItem('pocketrpg_lastTick', String(savedLastTick))
    }
    if (data.settings?.activeTask) {
      localStorage.setItem('pocketrpg_activeTask', JSON.stringify(data.settings.activeTask))
    }

    console.log('[PocketRPG] Restored from localStorage backup, timestamp:', data.timestamp)
    return data
  } catch (err) {
    console.warn('[PocketRPG] Restore from backup failed:', err)
    return null
  }
}
