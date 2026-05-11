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
