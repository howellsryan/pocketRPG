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
import { simulateIdleSkilling } from '../../../src/engine/idleEngine.js'
import skillsData from '../../../src/data/skills.json' assert { type: 'json' }
import { PRODUCTION_SKILLS } from '../../../src/utils/constants.js'

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

// ── Idle skilling (Phase C increment 2) ──────────────────────────────────────
// Production skilling only (type:'skill' → simulateIdleSkilling). Gathering,
// combat, agility, thieving, hunter and farming use other idle paths and are
// out of scope here.

export const SKILL_IDLE_SKILLS = new Set(PRODUCTION_SKILLS)

// Build (and validate) a type:'skill' idle task from skills.json, gated on the
// character meeting the action's level requirement.
export function buildSkillTask(save, skill, actionId) {
  if (!SKILL_IDLE_SKILLS.has(skill)) {
    throw new GameApiError(
      'UNSUPPORTED_SKILL',
      `Idle skilling via MCP supports production skills only (${[...SKILL_IDLE_SKILLS].join(', ')}).`,
      400,
    )
  }
  const skillDef = skillsData[skill]
  const actions = Array.isArray(skillDef?.actions) ? skillDef.actions : []
  const action = actions.find((a) => a.id === actionId)
  if (!action) throw new GameApiError('UNKNOWN_ACTION', `Unknown ${skill} action '${actionId}'. See pocketrpg://reference/skills.`, 400)
  const level = getLevelFromXP(Number(save.stats?.[skill]?.xp) || 0)
  if (action.level && level < action.level) {
    throw new GameApiError('LEVEL_TOO_LOW', `${skill} ${action.level} required (you have ${level})`, 400)
  }
  return { type: 'skill', skill, action, bankingEnabled: true }
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

// Apply a simulateIdleSkilling result to the save. Mirrors the client's
// load-time application (gameState.jsx) exactly for type:'skill' tasks so the
// two paths can't drift: XP (capped), dungeoneering tokens, consumed inputs
// (from bank), the final inventory, and auto-banked overflow.
export function applyIdleSkillResult(save, sim) {
  if (!save.stats || typeof save.stats !== 'object') save.stats = {}
  if (!save.bank || typeof save.bank !== 'object') save.bank = {}

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

  if (Array.isArray(sim.finalInventory)) save.inventory = sim.finalInventory

  const banked = sim.itemsBanked || {}
  for (const [itemId, qty] of Object.entries(banked)) {
    if (qty <= 0) continue
    const existing = save.bank[itemId]
    save.bank[itemId] = existing
      ? { ...existing, quantity: (Number(existing.quantity) || 0) + qty }
      : { itemId, quantity: qty }
  }

  const named = (obj) => Object.entries(obj || {}).map(([itemId, quantity]) => ({ itemId, name: itemsData[itemId]?.name || itemId, quantity }))
  return {
    skill: sim.skill,
    action: sim.actionName,
    actions: sim.actions || 0,
    xpGained: sim.xpGained || {},
    itemsBanked: named(banked),
    itemsConsumed: named(sim.itemsConsumed),
    stoppedReason: sim.stoppedReason || null,
  }
}

// Run the idle skilling simulation for an elapsed window and apply it. Pure
// over the save (no DB); the caller persists.
export function runIdleSkilling(save, task, elapsedMs) {
  const slots = toSlotArray(save)
  const sim = simulateIdleSkilling(task, elapsedMs, save.bank || {}, save.equipment || {}, save.stats || {}, itemsData, slots)
  if (!sim) return { applied: false, reason: 'no_progress' }
  return { applied: true, ...applyIdleSkillResult(save, sim) }
}
