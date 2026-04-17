import { getDB, deleteDB } from './database.js'
import { fnv1a } from '../utils/helpers.js'
import { ALL_SKILLS, INVENTORY_SIZE, EQUIPMENT_SLOTS } from '../utils/constants.js'

const SAVE_VERSION = 1

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers — shared by file export, localStorage snapshot, and the
// Cloudflare cloud-save sync.
// ─────────────────────────────────────────────────────────────────────────────

export function encodeSaveData(data) {
  const json = JSON.stringify(data)
  const hash = fnv1a(json)
  const payload = JSON.stringify({ hash, data: json })
  const base64 = btoa(unescape(encodeURIComponent(payload)))
  return { base64, hash }
}

export function decodeSaveBase64(base64) {
  const decoded = decodeURIComponent(escape(atob(base64)))
  const { hash, data: json } = JSON.parse(decoded)
  if (fnv1a(json) !== hash) throw new Error('Save integrity check failed')
  return { hash, data: JSON.parse(json) }
}

// Build a save payload object from live in-memory game state. Used by the
// 60s tick snapshot and the cloud-sync push.
export function buildSavePayloadFromState(player, stats, inventory, bank, equipment) {
  const data = {
    version: SAVE_VERSION,
    timestamp: Date.now(),
    player,
    stats,
    inventory,
    bank,
    equipment,
    settings: {},
  }
  try { data.settings.activeTask = JSON.parse(localStorage.getItem('pocketrpg_activeTask')) } catch { data.settings.activeTask = null }
  data.settings.lastTick = parseInt(localStorage.getItem('pocketrpg_lastTick'), 10) || data.timestamp
  return data
}

// Reads the entire persisted game state from IDB into a payload object.
async function readSavePayloadFromDB() {
  const db = await getDB()
  const data = {
    version: SAVE_VERSION,
    timestamp: Date.now(),
    player: await db.get('player', 'profile'),
    stats: {},
    inventory: [],
    bank: {},
    equipment: {},
    settings: {},
  }

  for (const skill of ALL_SKILLS) {
    data.stats[skill] = await db.get('stats', skill)
  }

  for (let i = 0; i < INVENTORY_SIZE; i++) {
    data.inventory[i] = await db.get('inventory', i) || null
  }

  const bankKeys = await db.getAllKeys('bank')
  for (const key of bankKeys) {
    data.bank[key] = await db.get('bank', key)
  }

  for (const slot of EQUIPMENT_SLOTS) {
    data.equipment[slot] = await db.get('equipment', slot) || null
  }

  const settingKeys = await db.getAllKeys('settings')
  for (const key of settingKeys) {
    data.settings[key] = await db.get('settings', key)
  }

  return data
}

// Wipe IDB and apply a decoded save payload. Shared by file import,
// localStorage-backup restore, and cloud-save pull.
export async function applySavePayload(data) {
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

  if (data.settings) {
    const setTx = db.transaction('settings', 'readwrite')
    for (const [key, val] of Object.entries(data.settings)) {
      if (key === 'activeTask' || key === 'lastTick' || val == null) continue
      // settings rows are stored as { key, value } objects (see stores.js)
      const wrapped = (val && typeof val === 'object' && 'key' in val && 'value' in val) ? val : { key, value: val }
      setTx.store.put(wrapped, key)
    }
    await setTx.done
  }

  // Restore localStorage idle keys so the engine sees the right elapsed window.
  const savedLastTick = data.settings?.lastTick || data.timestamp
  if (savedLastTick) localStorage.setItem('pocketrpg_lastTick', String(savedLastTick))
  if (data.settings?.activeTask) {
    localStorage.setItem('pocketrpg_activeTask', JSON.stringify(data.settings.activeTask))
  } else {
    localStorage.removeItem('pocketrpg_activeTask')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function exportSave() {
  const data = await readSavePayloadFromDB()
  const { base64 } = encodeSaveData(data)

  const blob = new Blob([base64], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pocketrpg_${data.player?.name || 'save'}_${Date.now()}.pocketrpg`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importSave(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const { data } = decodeSaveBase64(e.target.result)
        await applySavePayload(data)
        resolve()
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsText(file)
  })
}

export function snapshotToLocalStorage(player, stats, inventory, bank, equipment) {
  try {
    const data = buildSavePayloadFromState(player, stats, inventory, bank, equipment)
    const { base64 } = encodeSaveData(data)
    localStorage.setItem('pocketrpg_backup', base64)
    console.log('[PocketRPG] Snapshot saved to localStorage, size:', base64.length)
  } catch (err) {
    console.warn('[PocketRPG] Backup snapshot failed:', err)
  }
}

export async function restoreFromLocalStorage() {
  try {
    const encoded = localStorage.getItem('pocketrpg_backup')
    if (!encoded) return null
    const { data } = decodeSaveBase64(encoded)
    await applySavePayload(data)
    console.log('[PocketRPG] Restored from localStorage backup, timestamp:', data.timestamp)
    return data
  } catch (err) {
    console.warn('[PocketRPG] Restore from backup failed:', err)
    return null
  }
}
