// Phase C save intents: pure, deterministic mutations of a decoded saveObject,
// composed from the proven server-side game helpers + the pure engine. Each
// throws a GameApiError on an invalid request and otherwise mutates the save in
// place, returning a small summary. Callers apply them between
// loadCharacterWithSave and writeSave, so a throw means nothing is persisted
// (atomic by construction). No value is created here — items only move between
// inventory, bank and equipment.

import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { GameApiError } from '../game/errors.js'
import {
  canonicalItemId,
  normalizeSaveItemIds,
  getInventory,
  addItemToInventory,
  removeItemFromInventory,
  addItemToBank,
  removeItemFromBank,
  bankQuantity,
} from '../game/inventory.js'
import { equipItem, unequipSlot, checkEquipRequirements, createEquipment } from '../../../src/engine/equipment.js'
import { getLevelFromXP } from '../../../src/engine/experience.js'
import { simulateIdleSkilling, simulateIdleAgility } from '../../../src/engine/idleEngine.js'
import { simulateIdleThieving } from '../../../src/engine/thieving.js'
import { simulateIdleHunting } from '../../../src/engine/hunter.js'
import skillsData from '../../../src/data/skills.json' assert { type: 'json' }
import { PRODUCTION_SKILLS, IDLE_AUTOBANK_GATHERING_SKILLS } from '../../../src/utils/constants.js'

const XP_CAP = 200000000

const EQUIPMENT_SLOTS = new Set(Object.keys(createEquipment()))

function resolveItem(rawItemId) {
  if (!rawItemId || typeof rawItemId !== 'string') throw new GameApiError('INVALID_ITEM_ID', 'Invalid item_id', 400)
  const itemId = canonicalItemId(itemsData, rawItemId)
  const item = itemsData[itemId] || itemsData[rawItemId]
  if (!item) throw new GameApiError('ITEM_NOT_FOUND', `No item with id '${rawItemId}'`, 404)
  return { itemId, item }
}

function isStackable(itemId) {
  return !!itemsData[itemId]?.stackable
}

export function depositToBank(save, rawItemId, quantity) {
  normalizeSaveItemIds(save, itemsData)
  const { itemId } = resolveItem(rawItemId)
  removeItemFromInventory(save, itemId, quantity) // throws if not enough in inventory
  addItemToBank(save, itemId, quantity)
  return { action: 'deposit', itemId, name: itemsData[itemId]?.name || itemId, quantity: Math.floor(Number(quantity)) }
}

export function withdrawFromBank(save, rawItemId, quantity) {
  normalizeSaveItemIds(save, itemsData)
  const { itemId } = resolveItem(rawItemId)
  removeItemFromBank(save, itemId, quantity) // throws if not enough in bank
  addItemToInventory(save, itemId, quantity, { stackable: isStackable(itemId) }) // throws if inventory full
  return { action: 'withdraw', itemId, name: itemsData[itemId]?.name || itemId, quantity: Math.floor(Number(quantity)) }
}

// Put an unequipped equipment entry back into the inventory, preserving ammo
// quantity and weapon charges. Respects the 28-slot cap.
function returnEntryToInventory(save, entry) {
  const inv = getInventory(save)
  const itemId = entry.itemId
  if (isStackable(itemId)) {
    const qty = Math.floor(Number(entry.quantity) || 1)
    const existing = inv.find((s) => s?.itemId === itemId && !s.noted)
    if (existing) { existing.quantity = (Number(existing.quantity) || 0) + qty; return }
    if (inv.length >= 28) throw new GameApiError('INVENTORY_FULL', 'Inventory is full', 409)
    inv.push({ itemId, quantity: qty })
    return
  }
  if (inv.length >= 28) throw new GameApiError('INVENTORY_FULL', 'Inventory is full', 409)
  const slot = { itemId, quantity: 1 }
  if (entry.charges && entry.charges > 0) slot.charges = entry.charges
  inv.push(slot)
}

export function equip(save, rawItemId) {
  normalizeSaveItemIds(save, itemsData)
  const { itemId, item } = resolveItem(rawItemId)
  if (!item.slot || !EQUIPMENT_SLOTS.has(item.slot)) {
    throw new GameApiError('NOT_EQUIPPABLE', `${item.name || itemId} cannot be equipped`, 400)
  }

  const inv = getInventory(save)
  const owned = inv.filter((s) => s?.itemId === itemId)
  if (owned.length === 0) throw new GameApiError('NOT_IN_INVENTORY', `${item.name || itemId} is not in the inventory`, 400)

  const completedQuests = new Set(Array.isArray(save.settings?.completedQuests) ? save.settings.completedQuests : [])
  const reqError = checkEquipRequirements(item, save.stats || {}, completedQuests)
  if (reqError) {
    const msg = reqError.reason === 'skill'
      ? `Requires ${reqError.skill} ${reqError.required} (you have ${reqError.current})`
      : `Requires the quest '${reqError.questUnlock}'`
    throw new GameApiError('EQUIP_REQUIREMENT', msg, 400)
  }

  if (!save.equipment || typeof save.equipment !== 'object') save.equipment = createEquipment()

  // Ammo equips the whole stack; everything else equips one.
  const isAmmo = item.slot === 'ammo'
  const available = owned.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0)
  const equipQty = isAmmo ? available : 1
  const sourceSlot = isAmmo ? { ...owned[0], quantity: available } : owned[0]

  const result = equipItem(save.equipment, item, itemsData, sourceSlot)
  if (!result.equipped) {
    const reason = result.reason === 'wrong_ammo_type' ? 'That ammo is not compatible with the equipped weapon' : 'Item cannot be equipped'
    throw new GameApiError('EQUIP_FAILED', reason, 400)
  }

  // Free the equipped item first (so swaps stay within the 28-slot cap), then
  // return anything that was unequipped.
  removeItemFromInventory(save, itemId, equipQty)
  for (const entry of result.unequipped) if (entry) returnEntryToInventory(save, entry)

  return {
    action: 'equip',
    slot: item.slot,
    itemId,
    name: item.name || itemId,
    unequipped: result.unequipped.filter(Boolean).map((e) => ({ itemId: e.itemId, name: itemsData[e.itemId]?.name || e.itemId })),
  }
}

export function unequip(save, slot) {
  if (!EQUIPMENT_SLOTS.has(slot)) throw new GameApiError('INVALID_SLOT', `Invalid equipment slot '${slot}'`, 400)
  const entry = save.equipment?.[slot]
  if (!entry) throw new GameApiError('NOTHING_EQUIPPED', `Nothing equipped in the ${slot} slot`, 400)
  returnEntryToInventory(save, entry) // throws if inventory full (before clearing the slot)
  unequipSlot(save.equipment, slot)
  return { action: 'unequip', slot, itemId: entry.itemId, name: itemsData[entry.itemId]?.name || entry.itemId }
}

export const EQUIP_SLOT_NAMES = [...EQUIPMENT_SLOTS]

// ── Idle activities (Phase C increments 2-3) ─────────────────────────────────
// Skills the idle engine drives via simulateIdleSkilling (type:'skill'):
// the three gathering skills (woodcutting/mining/fishing — auto-bank + tool
// speed handled inside the simulator) plus the production skills.
export const SKILL_IDLE_SKILLS = new Set([...IDLE_AUTOBANK_GATHERING_SKILLS, ...PRODUCTION_SKILLS])

// All non-combat skills an agent can train via MCP, including the three with
// their own simulators (agility/thieving/hunter). Combat, farming, prayer,
// magic, construction, dungeoneering and slayer use other systems.
export const SUPPORTED_IDLE_SKILLS = [...SKILL_IDLE_SKILLS, 'agility', 'thieving', 'hunter']

const SUPPORTED_IDLE_TYPES = new Set(['skill', 'agility', 'thieving', 'hunter'])

export function isClaimableTask(task) {
  if (!task || !SUPPORTED_IDLE_TYPES.has(task.type)) return false
  if (task.type === 'skill') return SKILL_IDLE_SKILLS.has(task.skill)
  return true
}

function findSkillEntry(skill, key, id) {
  const list = Array.isArray(skillsData[skill]?.[key]) ? skillsData[skill][key] : []
  const entry = list.find((e) => e.id === id)
  if (!entry) throw new GameApiError('UNKNOWN_ACTION', `Unknown ${skill} option '${id}'. See pocketrpg://reference/skills.`, 400)
  return entry
}

function requireSkillLevel(save, skill, entry) {
  const level = getLevelFromXP(Number(save.stats?.[skill]?.xp) || 0)
  if (entry.level && level < entry.level) {
    throw new GameApiError('LEVEL_TOO_LOW', `${skill} ${entry.level} required (you have ${level})`, 400)
  }
}

// Build (and validate) a type:'skill' idle task — production + gathering.
export function buildSkillTask(save, skill, actionId) {
  if (!SKILL_IDLE_SKILLS.has(skill)) {
    throw new GameApiError('UNSUPPORTED_SKILL', `'${skill}' is not a simulateIdleSkilling skill.`, 400)
  }
  const action = findSkillEntry(skill, 'actions', actionId)
  requireSkillLevel(save, skill, action)
  return { type: 'skill', skill, action, bankingEnabled: true }
}

// Build any supported idle task from skills.json, gated on the level requirement.
export function buildIdleTask(save, skill, actionId) {
  if (SKILL_IDLE_SKILLS.has(skill)) return buildSkillTask(save, skill, actionId)
  if (skill === 'agility') {
    const action = findSkillEntry('agility', 'actions', actionId)
    requireSkillLevel(save, 'agility', action)
    return { type: 'agility', action }
  }
  if (skill === 'thieving') {
    const npc = findSkillEntry('thieving', 'npcs', actionId)
    requireSkillLevel(save, 'thieving', npc)
    return { type: 'thieving', npc }
  }
  if (skill === 'hunter') {
    const action = findSkillEntry('hunter', 'actions', actionId)
    requireSkillLevel(save, 'hunter', action)
    return { type: 'hunter', action }
  }
  throw new GameApiError(
    'UNSUPPORTED_SKILL',
    `Idle training via MCP supports: ${SUPPORTED_IDLE_SKILLS.join(', ')}.`,
    400,
  )
}

// Decoded save inventory (compact occupied-slot array) → the fixed 28-slot
// array (null-padded) the idle engine expects.
export function toSlotArray(save) {
  const arr = new Array(28).fill(null)
  const inv = Array.isArray(save.inventory) ? save.inventory : []
  let i = 0
  for (const slot of inv) {
    if (!slot || typeof slot !== 'object') continue
    const itemId = slot.itemId ?? slot.id
    const quantity = Math.floor(Number(slot.quantity) || 0)
    if (!itemId || quantity < 1 || i >= 28) continue
    arr[i++] = { ...slot, itemId, quantity }
  }
  return arr
}

// Coins from agility/thieving land in the inventory (stackable, coalescing),
// falling back to the bank when the inventory is full — matching the client.
function addCoinsInventoryFirst(save, qty) {
  if (qty <= 0) return
  try { addItemToInventory(save, 'coins', qty, { stackable: true }) }
  catch { addItemToBank(save, 'coins', qty) }
}

const named = (obj) => Object.entries(obj || {}).map(([itemId, quantity]) => ({ itemId, name: itemsData[itemId]?.name || itemId, quantity }))

// Apply an idle simulation result to the save. Mirrors the client's load-time
// application (gameState.jsx) exactly per task type so the two paths can't drift.
export function applyIdleResult(save, sim, type) {
  if (!save.stats || typeof save.stats !== 'object') save.stats = {}
  if (!save.bank || typeof save.bank !== 'object') save.bank = {}

  // XP (all types) — only for skills the save already tracks.
  if (sim.xpGained) {
    for (const [skill, xp] of Object.entries(sim.xpGained)) {
      if (xp > 0 && save.stats[skill]) {
        const newXP = Math.min((save.stats[skill].xp || 0) + Math.floor(xp), XP_CAP)
        save.stats[skill] = { ...save.stats[skill], xp: newXP, level: getLevelFromXP(newXP) }
      }
    }
  }

  if (sim.dungeoneeringTokensGained > 0) {
    if (!save.settings || typeof save.settings !== 'object') save.settings = {}
    save.settings.dungeoneeringTokens = (Number(save.settings.dungeoneeringTokens) || 0) + Math.floor(sim.dungeoneeringTokensGained)
  }

  if (sim.itemsConsumed) {
    for (const [itemId, qty] of Object.entries(sim.itemsConsumed)) {
      const existing = save.bank[itemId]
      if (!existing) continue
      const newQty = (Number(existing.quantity) || 0) - qty
      if (newQty <= 0) delete save.bank[itemId]
      else save.bank[itemId] = { ...existing, quantity: newQty }
    }
  }

  const bankAdd = (itemId, qty) => {
    if (qty <= 0) return
    const existing = save.bank[itemId]
    save.bank[itemId] = existing
      ? { ...existing, quantity: (Number(existing.quantity) || 0) + qty }
      : { itemId, quantity: qty }
  }

  let banked = {}
  if (type === 'skill' || type === 'gather' || type === 'clue') {
    if (Array.isArray(sim.finalInventory)) save.inventory = sim.finalInventory
    banked = sim.lootBanked || sim.itemsBanked || {}
    for (const [itemId, qty] of Object.entries(banked)) bankAdd(itemId, qty)
  } else if (type === 'agility' || type === 'thieving') {
    addCoinsInventoryFirst(save, Number(sim.coinsGained) || 0)
  } else if (type === 'hunter') {
    for (const reward of sim.rewards || []) bankAdd(reward.itemId, reward.quantity)
  } else if (sim.itemsGained) {
    for (const [itemId, qty] of Object.entries(sim.itemsGained)) bankAdd(itemId, qty)
  }

  return {
    skill: sim.skill,
    action: sim.actionName,
    actions: sim.actions || sim.laps || 0,
    xpGained: sim.xpGained || {},
    coinsGained: Number(sim.coinsGained) || 0,
    itemsBanked: named(banked),
    rewards: type === 'hunter' ? (sim.rewards || []).map((r) => ({ itemId: r.itemId, name: itemsData[r.itemId]?.name || r.itemId, quantity: r.quantity })) : undefined,
    itemsConsumed: named(sim.itemsConsumed),
    stoppedReason: sim.stoppedReason || null,
  }
}

// Run the right idle simulator for the task type and apply it. Pure over the
// save (no DB); the caller persists.
export function runIdleTask(save, task, elapsedMs) {
  let sim = null
  switch (task.type) {
    case 'skill':
      sim = simulateIdleSkilling(task, elapsedMs, save.bank || {}, save.equipment || {}, save.stats || {}, itemsData, toSlotArray(save))
      break
    case 'agility':
      sim = simulateIdleAgility(task, elapsedMs)
      break
    case 'thieving':
      sim = simulateIdleThieving(task, elapsedMs)
      break
    case 'hunter':
      sim = simulateIdleHunting(task, elapsedMs)
      break
    default:
      return { applied: false, reason: 'unsupported_type' }
  }
  if (!sim) return { applied: false, reason: 'no_progress' }
  return { applied: true, ...applyIdleResult(save, sim, task.type) }
}
