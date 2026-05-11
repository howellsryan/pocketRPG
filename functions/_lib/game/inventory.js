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

export function addItemToInventory(save, itemId, quantity) {
  const inv = getInventory(save)
  const qty = Math.floor(Number(quantity) || 0)
  if (qty < 1) throw new GameApiError('INVALID_QUANTITY', 'Invalid quantity', 400)
  const existing = inv.find(s => s?.itemId === itemId)
  if (existing) { existing.quantity = (Number(existing.quantity) || 0) + qty; return }
  if (inv.length >= 28) throw new GameApiError('INVENTORY_FULL', 'Inventory is full', 409)
  inv.push({ itemId, quantity: qty })
}


export function removeItemFromInventory(save, itemId, quantity) {
  const inv = getInventory(save)
  const qty = Math.floor(Number(quantity) || 0)
  if (qty < 1) throw new GameApiError('INVALID_QUANTITY', 'Invalid quantity', 400)
  const idx = inv.findIndex(s => s?.itemId === itemId)
  if (idx === -1) throw new GameApiError('INSUFFICIENT_SUPPLIES', 'Insufficient supplies', 400)
  const cur = Number(inv[idx].quantity) || 0
  if (cur < qty) throw new GameApiError('INSUFFICIENT_SUPPLIES', 'Insufficient supplies', 400)
  const next = cur - qty
  if (next <= 0) inv.splice(idx, 1)
  else inv[idx].quantity = next
}
