import { getDB, deleteDB } from './database.js'
import { INVENTORY_SIZE } from '../utils/constants.js'

const SAVE_VERSION = 1

// Build a save payload object from live in-memory game state. Used by the
// 60s tick snapshot and the cloud-sync push.
export function buildSavePayloadFromState(player, stats, inventory, bank, equipment, bankConfig, homeShortcuts, bossKillCounts, completedQuests, questQueue, combatStance, unlockedFeatures) {
  // Legacy wrapper. Prefer buildSavePayloadFromSnapshot() for new call sites.
  return buildSavePayloadFromSnapshot({
    player,
    stats,
    inventory,
    bank,
    equipment,
    settings: {
      bankConfig,
      homeShortcuts,
      bossKillCounts,
      completedQuests,
      questQueue,
      combatStance,
      unlockedFeatures,
    },
  })
}

function normaliseSaveSettings(settings = {}) {
  const next = { ...settings }
  if (next.unlockedFeatures instanceof Set) next.unlockedFeatures = [...next.unlockedFeatures]
  if (next.completedQuests instanceof Set) next.completedQuests = [...next.completedQuests]
  if (next.unlockedMinigameItems instanceof Set) next.unlockedMinigameItems = [...next.unlockedMinigameItems]
  return next
}

export function buildSavePayloadFromSnapshot(snapshot) {
  const { player, stats, inventory, bank, equipment, settings = {} } = snapshot || {}
  return {
    version: SAVE_VERSION,
    timestamp: Date.now(),
    player,
    stats,
    inventory,
    bank,
    equipment,
    settings: normaliseSaveSettings(settings),
  }
}

// Wipe IDB and apply a decoded save payload. Shared by localStorage-backup
// restore and cloud-save pull.
export async function applySavePayload(data, options = {}) {
  const { restoreLocalIdleMirrors = false } = options
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
  if (restoreLocalIdleMirrors) {
    const savedLastTick = data.settings?.lastTick || data.timestamp
    if (savedLastTick) localStorage.setItem('pocketrpg_lastTick', String(savedLastTick))
    if (data.settings?.activeTask) {
      localStorage.setItem('pocketrpg_activeTask', JSON.stringify(data.settings.activeTask))
    } else {
      localStorage.removeItem('pocketrpg_activeTask')
    }
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
  // Reset the clock-rollback watermark on character switch so the new
  // character doesn't inherit a future-looking timestamp from the previous
  // one (which would perpetually flag legitimate progress as rolled-back).
  localStorage.removeItem('pocketrpg_maxObservedAt')
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function snapshotToLocalStorage(player, stats, inventory, bank, equipment, bankConfig, homeShortcuts, bossKillCounts, completedQuests, questQueue, combatStance, unlockedFeatures) {
  // Deprecated durable local backup path.
  void player; void stats; void inventory; void bank; void equipment
  void bankConfig; void homeShortcuts; void bossKillCounts; void completedQuests; void questQueue; void combatStance; void unlockedFeatures
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
