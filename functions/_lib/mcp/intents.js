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
