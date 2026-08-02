import { getDB, clearAllStores } from './database.js'
import { INVENTORY_SIZE } from '../utils/constants.js'
import { LOCAL_WRITE_MARKER_KEY, getSetting } from './stores.js'

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
  // Boss/raid kill counts are server-authoritative in the kill_counts table
  // (migration 0019). They must never ride the save blob — counters get
  // clobbered by last-write-wins merges, which is what lost users their KC.
  delete next.bossKillCounts
  delete next.raidKillCounts
  // Hard Mode switches decide server-side drop rates (§14) and live in
  // hard_mode_targets — a save blob that could carry them is a save blob that
  // could turn them on.
  delete next.hardModeTargets
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

/** Settings that live ONLY in the server's own tables and are deliberately
 * stripped from the save blob, so a payload can never carry them back. They
 * have to survive applySavePayload's wipe or the pull silently deletes them. */
export const SERVER_OWNED_SETTINGS = ['bossKillCounts', 'raidKillCounts', 'hardModeTargets']

async function readPreservedSettings() {
  const out = {}
  for (const key of SERVER_OWNED_SETTINGS) {
    try {
      const value = await getSetting(key)
      if (value != null) out[key] = value
    } catch { /* a missing store on a fresh DB is not an error */ }
  }
  return out
}

async function writePreservedSettings(db, preserved) {
  const keys = Object.keys(preserved)
  if (!keys.length) return
  const tx = db.transaction('settings', 'readwrite')
  for (const key of keys) tx.store.put({ key, value: preserved[key] }, key)
  await tx.done
}

// Wipe IDB and apply a decoded save payload. Shared by localStorage-backup
// restore and cloud-save pull.
export async function applySavePayload(data, options = {}) {
  const { restoreLocalIdleMirrors = false } = options
  // Kill counts are stripped from every save payload on the way out
  // (normaliseSaveSettings) because they are server-authoritative. That makes
  // their absence here mean "untouched", never "zero" — the same rule as
  // banked charges (§4). Without carrying them across the wipe, every save
  // pull erased them: leaving a co-op fight or dying re-locked the boss the
  // player had just been fighting, because its kill-count gate read {}.
  const preserved = await readPreservedSettings()
  await clearAllStores()
  const db = await getDB()
  await writePreservedSettings(db, preserved)

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
  await clearAllStores()
  localStorage.removeItem('pocketrpg_backup')
  localStorage.removeItem('pocketrpg_lastTick')
  localStorage.removeItem('pocketrpg_activeTask')
  localStorage.removeItem('pocketrpg_hiddenAt')
  // Reset the clock-rollback watermark on character switch so the new
  // character doesn't inherit a future-looking timestamp from the previous
  // one (which would perpetually flag legitimate progress as rolled-back).
  localStorage.removeItem('pocketrpg_maxObservedAt')
  localStorage.removeItem(LOCAL_WRITE_MARKER_KEY)
  // Per-activity progress ledger (quests/minigames) is cached in localStorage
  // outside IDB — must be dropped too, or a previous character's (or the
  // offline demo's) entries survive and get merged into the next character's
  // ledger on the next saveActivityProgress() call, overwriting their cloud copy.
  localStorage.removeItem('pocketrpg_activityProgress')
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
