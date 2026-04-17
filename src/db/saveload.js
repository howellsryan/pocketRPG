import { getDB, deleteDB } from './database.js'
import { INVENTORY_SIZE } from '../utils/constants.js'

const SAVE_VERSION = 1

// Build a save payload object from live in-memory game state. Used by the
// 60s tick snapshot and the cloud-sync push.
export function buildSavePayloadFromState(player, stats, inventory, bank, equipment, bankConfig, homeShortcuts, bossKillCounts) {
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
  if (bankConfig) data.settings.bankConfig = bankConfig
  if (homeShortcuts) data.settings.homeShortcuts = homeShortcuts
  if (bossKillCounts) data.settings.bossKillCounts = bossKillCounts
  return data
}

// Wipe IDB and apply a decoded save payload. Shared by localStorage-backup
// restore and cloud-save pull.
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

// Wipe everything we persist per-character on the local device. Used when
// switching to a different character so the new character doesn't inherit
// IDB rows or idle-engine timers from the previous one.
export async function wipeLocalSave() {
  await deleteDB()
  localStorage.removeItem('pocketrpg_backup')
  localStorage.removeItem('pocketrpg_lastTick')
  localStorage.removeItem('pocketrpg_activeTask')
  localStorage.removeItem('pocketrpg_hiddenAt')
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function snapshotToLocalStorage(player, stats, inventory, bank, equipment, bankConfig, homeShortcuts, bossKillCounts) {
  try {
    const data = buildSavePayloadFromState(player, stats, inventory, bank, equipment, bankConfig, homeShortcuts, bossKillCounts)
    const json = JSON.stringify(data)
    localStorage.setItem('pocketrpg_backup', json)
    console.log('[PocketRPG] Snapshot saved to localStorage, size:', json.length)
  } catch (err) {
    console.warn('[PocketRPG] Backup snapshot failed:', err)
  }
}

export async function restoreFromLocalStorage() {
  try {
    const json = localStorage.getItem('pocketrpg_backup')
    if (!json) return null
    const data = JSON.parse(json)
    await applySavePayload(data)
    console.log('[PocketRPG] Restored from localStorage backup, timestamp:', data.timestamp)
    return data
  } catch (err) {
    console.warn('[PocketRPG] Restore from backup failed:', err)
    return null
  }
}
