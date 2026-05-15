import { GameApiError } from './errors.js'

export function getInventory(save) {
  if (!Array.isArray(save.inventory)) {
    save.inventory = []
    return save.inventory
  }
  // Some historical/client payloads may store inventory as a fixed 28-slot
  // array with null/empty entries. Normalize to occupied slots so slot-cap
  // checks reflect actual item usage.
  save.inventory = save.inventory
    .map((slot) => {
      if (!slot || typeof slot !== 'object') return null
      const itemId = typeof slot.itemId === 'string' && slot.itemId
        ? slot.itemId
        : (typeof slot.id === 'string' ? slot.id : null)
      const quantity = Math.floor(Number(slot.quantity) || 0)
      if (!itemId || quantity < 1) return null
      return { ...slot, itemId, quantity }
    })
    .filter(Boolean)
  return save.inventory
}

export function addItemToInventory(save, itemId, quantity, { stackable = true, noted = false } = {}) {
  const inv = getInventory(save)
  const qty = Math.floor(Number(quantity) || 0)
  if (qty < 1) throw new GameApiError('INVALID_QUANTITY', 'Invalid quantity', 400)

  if (!stackable && !noted) {
    if (inv.length + qty > 28) throw new GameApiError('INVENTORY_FULL', 'Inventory is full', 409)
    for (let i = 0; i < qty; i += 1) inv.push({ itemId, quantity: 1 })
    return
  }

  const existing = inv.find(s => s?.itemId === itemId && Boolean(s?.noted) === Boolean(noted))
  if (existing) {
    existing.quantity = (Number(existing.quantity) || 0) + qty
    return
  }
  if (inv.length >= 28) throw new GameApiError('INVENTORY_FULL', 'Inventory is full', 409)
  inv.push(noted ? { itemId, quantity: qty, noted: true } : { itemId, quantity: qty })
}


export function removeItemFromInventory(save, itemId, quantity) {
  const inv = getInventory(save)
  const qty = Math.floor(Number(quantity) || 0)
  if (qty < 1) throw new GameApiError('INVALID_QUANTITY', 'Invalid quantity', 400)
  let available = 0
  for (const s of inv) {
    if (s?.itemId === itemId) available += Number(s.quantity) || 0
  }
  if (available < qty) throw new GameApiError('INSUFFICIENT_SUPPLIES', 'Insufficient supplies', 400)
  // Walk slots back-to-front so spliced indices don't shift the iteration.
  let remaining = qty
  for (let i = inv.length - 1; i >= 0 && remaining > 0; i--) {
    const s = inv[i]
    if (!s || s.itemId !== itemId) continue
    const cur = Number(s.quantity) || 0
    if (cur <= remaining) {
      remaining -= cur
      inv.splice(i, 1)
    } else {
      s.quantity = cur - remaining
      remaining = 0
    }
  }
}


export function addItemToBank(save, itemId, quantity) {
  const qty = Math.floor(Number(quantity) || 0)
  if (qty < 1) throw new GameApiError('INVALID_QUANTITY', 'Invalid quantity', 400)
  if (!save.bank || typeof save.bank !== 'object') save.bank = {}
  const existing = save.bank[itemId]
  const curQty = typeof existing === 'number'
    ? Math.floor(existing)
    : Math.floor(Number(existing?.quantity) || 0)
  save.bank[itemId] = { itemId, quantity: curQty + qty }
}
