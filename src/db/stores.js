import { getDB } from './database.js'
import { ALL_SKILLS, HITPOINTS_START_XP, INVENTORY_SIZE, EQUIPMENT_SLOTS } from '../utils/constants.js'
import { getStarterKit } from '../engine/createDefaultSave.js'

// A fresh page load has no memory of what this device already pushed to the
// cloud (lastPushedAt/lastSaveRevision in cloud/sync.js reset to zero on every
// reload) — so without this, a boot-time cloud pull always wins over IndexedDB,
// even when IDB holds a just-made change the debounced/critical push hasn't
// reached the server yet. This timestamp survives the reload (localStorage,
// unlike the in-memory sync state) so App.initCloudAndSave can tell "IDB was
// written after the cloud's last known save" and skip clobbering it.
export const LOCAL_WRITE_MARKER_KEY = 'pocketrpg_lastLocalWriteAt'

function markLocalWrite() {
  try { localStorage.setItem(LOCAL_WRITE_MARKER_KEY, String(Date.now())) } catch { /* non-fatal */ }
}

// ── Player Profile ──

export async function getPlayer() {
  const db = await getDB()
  return db.get('player', 'profile')
}

export async function savePlayer(profile) {
  const db = await getDB()
  const result = await db.put('player', profile, 'profile')
  markLocalWrite()
  return result
}

// ── Stats ──

export async function getStat(skill) {
  const db = await getDB()
  return db.get('stats', skill)
}

export async function getAllStats() {
  const db = await getDB()
  const stats = {}
  for (const skill of ALL_SKILLS) {
    const data = await db.get('stats', skill)
    stats[skill] = data || { skill, xp: 0, level: 1 }
  }
  return stats
}

export async function saveStat(skill, data) {
  const db = await getDB()
  const result = await db.put('stats', data, skill)
  markLocalWrite()
  return result
}

export async function saveAllStats(stats) {
  const db = await getDB()
  const tx = db.transaction('stats', 'readwrite')
  for (const [skill, data] of Object.entries(stats)) {
    tx.store.put(data, skill)
  }
  await tx.done
  markLocalWrite()
}

// ── Inventory ──

export async function getInventory() {
  const db = await getDB()
  const inv = new Array(INVENTORY_SIZE).fill(null)
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const item = await db.get('inventory', i)
    if (item) inv[i] = item
  }
  return inv
}

export async function saveInventory(inventory) {
  const db = await getDB()
  const tx = db.transaction('inventory', 'readwrite')
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    if (inventory[i]) {
      tx.store.put(inventory[i], i)
    } else {
      tx.store.delete(i)
    }
  }
  await tx.done
  markLocalWrite()
}

// ── Bank ──

export async function getBank() {
  const db = await getDB()
  const keys = await db.getAllKeys('bank')
  const bank = {}
  for (const key of keys) {
    bank[key] = await db.get('bank', key)
  }
  return bank
}

export async function saveBank(bank) {
  const db = await getDB()
  const tx = db.transaction('bank', 'readwrite')
  await tx.store.clear()
  for (const [itemId, data] of Object.entries(bank)) {
    tx.store.put(data, itemId)
  }
  await tx.done
  markLocalWrite()
}

// ── Equipment ──

export async function getEquipment() {
  const db = await getDB()
  const eq = {}
  for (const slot of EQUIPMENT_SLOTS) {
    const item = await db.get('equipment', slot)
    eq[slot] = item || null
  }
  return eq
}

export async function saveEquipment(equipment) {
  const db = await getDB()
  const tx = db.transaction('equipment', 'readwrite')
  for (const slot of EQUIPMENT_SLOTS) {
    if (equipment[slot]) {
      tx.store.put(equipment[slot], slot)
    } else {
      tx.store.delete(slot)
    }
  }
  await tx.done
  markLocalWrite()
}

// ── Settings ──

export async function getSetting(key) {
  const db = await getDB()
  const data = await db.get('settings', key)
  return data?.value
}

export async function saveSetting(key, value) {
  const db = await getDB()
  const result = await db.put('settings', { key, value }, key)
  markLocalWrite()
  return result
}

// ── New Game Initialization ──

export async function initNewGame(playerName, isIronman = false, isOneLife = false) {
  const db = await getDB()

  // Player profile
  await db.put('player', {
    name: playerName,
    is_ironman: isIronman,
    is_one_life: isOneLife,
    created: Date.now(),
    totalPlayTime: 0
  }, 'profile')

  // Initialize all skills
  const tx = db.transaction('stats', 'readwrite')
  for (const skill of ALL_SKILLS) {
    const xp = skill === 'hitpoints' ? HITPOINTS_START_XP : 0
    const level = skill === 'hitpoints' ? 10 : 1
    tx.store.put({ skill, xp, level }, skill)
  }
  await tx.done

  // Empty inventory, bank, equipment
  await saveInventory(new Array(INVENTORY_SIZE).fill(null))
  await saveBank({})
  const eq = {}
  for (const s of EQUIPMENT_SLOTS) eq[s] = null
  await saveEquipment(eq)

  // Give starter items — shared source of truth with the server's
  // createDefaultSave, including the account-type-specific head slot.
  const starterInv = new Array(INVENTORY_SIZE).fill(null)
  getStarterKit({ isIronman, isOneLife }).forEach((item, i) => { starterInv[i] = { ...item } })
  await saveInventory(starterInv)
}
