import { getDB } from './database.js'
import { ALL_SKILLS, HITPOINTS_START_XP, INVENTORY_SIZE, EQUIPMENT_SLOTS } from '../utils/constants.js'

// ── Player Profile ──

export async function getPlayer() {
  const db = await getDB()
  return db.get('player', 'profile')
}

export async function savePlayer(profile) {
  const db = await getDB()
  return db.put('player', profile, 'profile')
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
  return db.put('stats', data, skill)
}

export async function saveAllStats(stats) {
  const db = await getDB()
  const tx = db.transaction('stats', 'readwrite')
  for (const [skill, data] of Object.entries(stats)) {
    tx.store.put(data, skill)
  }
  await tx.done
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
}

// ── Settings ──

export async function getSetting(key) {
  const db = await getDB()
  const data = await db.get('settings', key)
  return data?.value
}

export async function saveSetting(key, value) {
  const db = await getDB()
  return db.put('settings', { key, value }, key)
}

// ── New Game Initialization ──

export async function initNewGame(playerName) {
  const db = await getDB()

  // Player profile
  await db.put('player', {
    name: playerName,
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

  // Give starter items
  const starterInv = new Array(INVENTORY_SIZE).fill(null)
  starterInv[0] = { itemId: 'bronze_dagger', quantity: 1 }
  starterInv[1] = { itemId: 'bronze_scimitar', quantity: 1 }
  starterInv[2] = { itemId: 'bronze_full_helm', quantity: 1 }
  starterInv[3] = { itemId: 'bronze_platebody', quantity: 1 }
  starterInv[4] = { itemId: 'bronze_platelegs', quantity: 1 }
  starterInv[5] = { itemId: 'bronze_kiteshield', quantity: 1 }
  starterInv[6] = { itemId: 'shrimp', quantity: 1 }
  starterInv[7] = { itemId: 'shrimp', quantity: 1 }
  starterInv[8] = { itemId: 'shrimp', quantity: 1 }
  starterInv[9] = { itemId: 'shrimp', quantity: 1 }
  starterInv[10] = { itemId: 'shrimp', quantity: 1 }
  starterInv[11] = { itemId: 'coins', quantity: 25 }
  await saveInventory(starterInv)
}
