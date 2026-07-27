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
 * Buy `qty` of a shard-priced item (item.shardglassShopCost) by spending
 * Shardglass Shards from the inventory. Pure: returns a fresh inventory on
 * success, or a failure reason. Never mutates the passed inventory.
 *
 * @returns {{ok:true, inventory:any[], totalCost:number, buyQty:number}
 *          | {ok:false, reason:'not_for_sale'|'insufficient_shards'|'no_space', totalCost?:number, owned?:number}}
 */
export function buyWithShards(inventory, item, qty, shardId = 'shardglass_shards') {
  const unitCost = Math.floor(Number(item?.shardglassShopCost) || 0)
  const buyQty = Math.max(1, Math.floor(Number(qty) || 1))
  if (unitCost <= 0 || !item?.id) return { ok: false, reason: 'not_for_sale' }
  const totalCost = unitCost * buyQty
  const owned = countItem(inventory, shardId)
  if (owned < totalCost) return { ok: false, reason: 'insufficient_shards', totalCost, owned }
  const newInv = inventory.map((s) => (s ? { ...s } : null))
  removeItem(newInv, shardId, totalCost)
  if (freeSlots(newInv) < buyQty) return { ok: false, reason: 'no_space', totalCost }
  for (let k = 0; k < buyQty; k++) addItem(newInv, item.id, 1, false)
  return { ok: true, inventory: newInv, totalCost, buyQty }
}

/**
 * Resolve an item's breakdown yield — the stack a player receives when they
 * break the item down (e.g. Shardglass gear → 5000 Shardglass Shards). Returns
 * { itemId, qty } or null when the item declares no breakdown.
 */
export function getBreakdownYield(item) {
  if (!item?.breakdownResult) return null
  const qty = Math.max(1, Math.floor(Number(item.breakdownQty) || 0))
  if (qty <= 0) return null
  return { itemId: item.breakdownResult, qty }
}

/**
 * Plan a whole-inventory deposit: which quantities go to the bank, which charge
 * pools travel with them, and what the inventory looks like afterwards. Pure —
 * the caller applies the result.
 *
 * `excludedItemIds` is the player's auto-bank exclusion set; those item types
 * stay in the inventory (charges and all). `charges` only carries entries for
 * items that actually hold charges: an absent field means "untouched" on a bank
 * rewrite, so writing a 0 here would wipe the banked pool (see bankCharges.js).
 *
 * @returns {{updates:Record<string,number>, charges:Record<string,number>,
 *            inventory:any[], deposited:number}}
 */
export function collectDepositAll(inventory, excludedItemIds = null) {
  const updates = {}
  const charges = {}
  const nextInventory = []
  let deposited = 0

  for (const slot of inventory) {
    if (!slot || (excludedItemIds && excludedItemIds.has(slot.itemId))) {
      nextInventory.push(slot || null)
      continue
    }
    updates[slot.itemId] = (updates[slot.itemId] || 0) + slot.quantity
    const slotCharges = Math.max(0, Math.floor(Number(slot.charges) || 0))
    if (slotCharges > 0) charges[slot.itemId] = (charges[slot.itemId] || 0) + slotCharges
    nextInventory.push(null)
    deposited++
  }

  return { updates, charges, inventory: nextInventory, deposited }
}

/**
 * Total the charges carried by the first `depositQty` un-noted copies of
 * `itemId` — the copies a non-stackable bank deposit actually moves. Reading a
 * single slot's charges instead destroyed the rest of the stack's pool.
 */
export function sumSlotCharges(inventory, itemId, depositQty) {
  const wanted = Math.max(0, Math.floor(Number(depositQty) || 0))
  let counted = 0
  let total = 0
  for (const slot of inventory) {
    if (counted >= wanted) break
    if (!slot || slot.itemId !== itemId || slot.noted) continue
    total += Math.max(0, Math.floor(Number(slot.charges) || 0))
    counted++
  }
  return total
}

/**
 * Swap two inventory slots
 */
export function swapSlots(inventory, slotA, slotB) {
  const temp = inventory[slotA]
  inventory[slotA] = inventory[slotB]
  inventory[slotB] = temp
}

/**
 * Mirror a server completion's `consumed` list into the local save. The server
 * owns the debit (`settleActionCompletion`), but the save blob is client-trusted
 * (§14) — so without mirroring it, the next /api/save push writes the consumed
 * item straight back and the action can be repeated forever.
 *
 * Pure: returns the next inventory plus the bank deltas the caller should feed
 * to updateBankDirect. Splitting them is deliberate — the client's bank and
 * inventory are updated through two different funnels.
 *
 * @returns { inventory, bankDeltas, changed }
 */
export function applyServerConsumed(inventory, consumed) {
  const next = (inventory || []).map(slot => (slot ? { ...slot } : null))
  const bankDeltas = {}
  let changed = false
  for (const entry of Array.isArray(consumed) ? consumed : []) {
    const itemId = typeof entry?.itemId === 'string' ? entry.itemId : null
    const qty = Math.floor(Number(entry?.quantity) || 0)
    if (!itemId || qty < 1) continue
    changed = true
    if (entry.source === 'bank') {
      bankDeltas[itemId] = (bankDeltas[itemId] || 0) - qty
      continue
    }
    // Take whatever the inventory actually still holds; anything the local pack
    // has already lost (a bank trip since the request went out) comes off the
    // bank instead, so the mirror never silently under-debits.
    const have = countItem(next, itemId)
    const fromInventory = Math.min(have, qty)
    if (fromInventory > 0) removeItem(next, itemId, fromInventory)
    if (qty - fromInventory > 0) bankDeltas[itemId] = (bankDeltas[itemId] || 0) - (qty - fromInventory)
  }
  return { inventory: next, bankDeltas, changed }
}
