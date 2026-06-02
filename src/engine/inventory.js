import { INVENTORY_SIZE } from '../utils/constants.js'

/**
 * Create a fresh empty inventory (array of 28 slots)
 * Each slot is null (empty) or { itemId, quantity }
 */
export function createInventory() {
  return new Array(INVENTORY_SIZE).fill(null)
}

/**
 * Count free slots
 */
export function freeSlots(inventory) {
  return inventory.filter(s => s === null).length
}

/**
 * Find the first slot containing a specific item
 */
export function findItem(inventory, itemId) {
  return inventory.findIndex(s => s && s.itemId === itemId)
}

/**
 * Find all slots containing a specific item
 */
export function findAllItems(inventory, itemId) {
  const slots = []
  for (let i = 0; i < inventory.length; i++) {
    if (inventory[i] && inventory[i].itemId === itemId) slots.push(i)
  }
  return slots
}

/**
 * Count total quantity of an item across all slots
 */
export function countItem(inventory, itemId) {
  return inventory.reduce((sum, slot) => {
    if (slot && slot.itemId === itemId) return sum + slot.quantity
    return sum
  }, 0)
}

/**
 * Returns true if every item in `items` ({ itemId: qty }) fits into the
 * inventory without dropping anything. Stackables that already occupy a slot
 * cost nothing; new stackables and non-stackables consume free slots.
 */
export function canFit(inventory, items, itemsData = {}) {
  let free = freeSlots(inventory)
  for (const [itemId, qty] of Object.entries(items)) {
    if (qty <= 0) continue
    const stackable = itemsData?.[itemId]?.stackable || false
    if (stackable) {
      const hasStack = inventory.some(s => s && s.itemId === itemId)
      if (!hasStack) {
        if (free <= 0) return false
        free -= 1
      }
    } else {
      if (free < qty) return false
      free -= qty
    }
  }
  return true
}

/**
 * Add item to inventory. Returns true if successful, false if full.
 * Stackable items go into existing stack or new slot.
 * Non-stackable items take one slot each.
 */
export function addItem(inventory, itemId, quantity, stackable = false) {
  if (stackable) {
    const existing = findItem(inventory, itemId)
    if (existing !== -1) {
      inventory[existing] = { ...inventory[existing], quantity: inventory[existing].quantity + quantity }
      return true
    }
  }

  if (stackable) {
    const empty = inventory.indexOf(null)
    if (empty === -1) return false
    inventory[empty] = { itemId, quantity }
    return true
  }

  // Non-stackable: need `quantity` free slots
  for (let q = 0; q < quantity; q++) {
    const empty = inventory.indexOf(null)
    if (empty === -1) return false
    inventory[empty] = { itemId, quantity: 1 }
  }
  return true
}

/**
 * Remove quantity of an item. Returns true if successful.
 */
export function removeItem(inventory, itemId, quantity = 1) {
  if (countItem(inventory, itemId) < quantity) return false

  let remaining = quantity
  for (let i = 0; i < inventory.length && remaining > 0; i++) {
    if (inventory[i] && inventory[i].itemId === itemId) {
      const take = Math.min(inventory[i].quantity, remaining)
      inventory[i].quantity -= take
      remaining -= take
      if (inventory[i].quantity <= 0) inventory[i] = null
    }
  }
  return true
}

/**
 * Remove quantity of an item, consuming un-noted slots before noted slots.
 * Returns true if successful.
 */
export function removeItemUnnotedFirst(inventory, itemId, quantity = 1) {
  if (countItem(inventory, itemId) < quantity) return false
  let remaining = quantity
  // First pass: un-noted
  for (let i = 0; i < inventory.length && remaining > 0; i++) {
    const slot = inventory[i]
    if (!slot || slot.itemId !== itemId || slot.noted) continue
    const take = Math.min(slot.quantity, remaining)
    inventory[i] = { ...slot, quantity: slot.quantity - take }
    if (inventory[i].quantity <= 0) inventory[i] = null
    remaining -= take
  }
  // Second pass: noted
  for (let i = 0; i < inventory.length && remaining > 0; i++) {
    const slot = inventory[i]
    if (!slot || slot.itemId !== itemId || !slot.noted) continue
    const take = Math.min(slot.quantity, remaining)
    inventory[i] = { ...slot, quantity: slot.quantity - take }
    if (inventory[i].quantity <= 0) inventory[i] = null
    remaining -= take
  }
  return true
}

/**
 * Swap two inventory slots
 */
export function swapSlots(inventory, slotA, slotB) {
  const temp = inventory[slotA]
  inventory[slotA] = inventory[slotB]
  inventory[slotB] = temp
}
