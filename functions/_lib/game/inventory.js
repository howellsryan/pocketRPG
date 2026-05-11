import { GameApiError } from './errors.js'

export function getInventory(save) {
  if (!Array.isArray(save.inventory)) save.inventory = []
  return save.inventory
}

export function addItemToInventory(save, itemId, quantity) {
  const inv = getInventory(save)
  const qty = Math.floor(Number(quantity) || 0)
  if (qty < 1) throw new GameApiError('INVALID_QUANTITY', 'Invalid quantity', 400)
  const existing = inv.find(s => s?.id === itemId)
  if (existing) { existing.quantity = (Number(existing.quantity) || 0) + qty; return }
  if (inv.length >= 28) throw new GameApiError('INVENTORY_FULL', 'Inventory is full', 409)
  inv.push({ id: itemId, quantity: qty })
}


export function removeItemFromInventory(save, itemId, quantity) {
  const inv = getInventory(save)
  const qty = Math.floor(Number(quantity) || 0)
  if (qty < 1) throw new GameApiError('INVALID_QUANTITY', 'Invalid quantity', 400)
  const idx = inv.findIndex(s => s?.id === itemId)
  if (idx === -1) throw new GameApiError('INSUFFICIENT_SUPPLIES', 'Insufficient supplies', 400)
  const cur = Number(inv[idx].quantity) || 0
  if (cur < qty) throw new GameApiError('INSUFFICIENT_SUPPLIES', 'Insufficient supplies', 400)
  const next = cur - qty
  if (next <= 0) inv.splice(idx, 1)
  else inv[idx].quantity = next
}
