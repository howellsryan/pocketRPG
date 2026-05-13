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
 * Deliver a single drop to inventory, overflowing remainder to a bank dict.
 * - Mutates `inventory` (28-slot array) and `bank` (dict keyed by itemId).
 * - `noted` drops always stack with other noted entries of the same itemId.
 * - Stackable items merge into an existing stack or take one slot.
 * - Non-stackable items take one slot per unit; excess overflows to bank.
 * Returns { addedToInventory, overflowedToBank } counts.
 */
export function deliverDropWithBankOverflow(inventory, bank, drop, stackable) {
  const itemId = drop.itemId
  const quantity = drop.quantity
  if (!itemId || !Number.isFinite(quantity) || quantity <= 0) {
    return { addedToInventory: 0, overflowedToBank: 0 }
  }

  const addToBank = (qty) => {
    if (qty <= 0) return
    if (bank[itemId]) {
      bank[itemId] = { ...bank[itemId], quantity: (bank[itemId].quantity || 0) + qty }
    } else {
      bank[itemId] = { itemId, quantity: qty }
    }
  }

  if (drop.noted) {
    const existing = inventory.findIndex(s => s && s.itemId === itemId && s.noted)
    if (existing !== -1) {
      inventory[existing] = { ...inventory[existing], quantity: inventory[existing].quantity + quantity }
      return { addedToInventory: quantity, overflowedToBank: 0 }
    }
    const empty = inventory.indexOf(null)
    if (empty !== -1) {
      inventory[empty] = { itemId, quantity, noted: true }
      return { addedToInventory: quantity, overflowedToBank: 0 }
    }
    addToBank(quantity)
    return { addedToInventory: 0, overflowedToBank: quantity }
  }

  if (stackable) {
    const existing = findItem(inventory, itemId)
    if (existing !== -1) {
      inventory[existing] = { ...inventory[existing], quantity: inventory[existing].quantity + quantity }
      return { addedToInventory: quantity, overflowedToBank: 0 }
    }
    const empty = inventory.indexOf(null)
    if (empty !== -1) {
      inventory[empty] = { itemId, quantity }
      return { addedToInventory: quantity, overflowedToBank: 0 }
    }
    addToBank(quantity)
    return { addedToInventory: 0, overflowedToBank: quantity }
  }

  let placed = 0
  for (let q = 0; q < quantity; q++) {
    const empty = inventory.indexOf(null)
    if (empty === -1) break
    inventory[empty] = { itemId, quantity: 1 }
    placed++
  }
  const overflow = quantity - placed
  if (overflow > 0) addToBank(overflow)
  return { addedToInventory: placed, overflowedToBank: overflow }
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
 * Swap two inventory slots
 */
export function swapSlots(inventory, slotA, slotB) {
  const temp = inventory[slotA]
  inventory[slotA] = inventory[slotB]
  inventory[slotB] = temp
}
