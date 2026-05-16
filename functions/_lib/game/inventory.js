import { GameApiError } from './errors.js'

// Some items in items.json are keyed by a legacy id but expose a different
// canonical id via the `id` field on the entry (e.g. key "rune_scimitar"
// holds id "runeforged_scimitar"). Save data on old clients still carries
// the legacy key. Resolve to the canonical id whenever we touch persistent
// state so writes from inventory (sell) and shop search (buy) use the same
// identifier on the trading post.
export function canonicalItemId(itemsData, rawId) {
  if (typeof rawId !== 'string' || !rawId) return rawId
  const direct = itemsData?.[rawId]
  if (direct && typeof direct.id === 'string' && direct.id) return direct.id
  return rawId
}

// Walk the save's inventory + bank and rewrite any legacy keys to their
// canonical id. Coalesces slots/entries that collapse onto the same id.
export function normalizeSaveItemIds(save, itemsData) {
  if (!save || !itemsData) return
  if (Array.isArray(save.inventory)) {
    for (const slot of save.inventory) {
      if (!slot || typeof slot !== 'object') continue
      const raw = typeof slot.itemId === 'string' && slot.itemId
        ? slot.itemId
        : (typeof slot.id === 'string' ? slot.id : null)
      if (!raw) continue
      const canon = canonicalItemId(itemsData, raw)
      if (canon !== slot.itemId) slot.itemId = canon
    }
  }
  if (save.bank && typeof save.bank === 'object') {
    const merged = {}
    for (const [key, val] of Object.entries(save.bank)) {
      const rawId = (val && typeof val === 'object' && typeof val.itemId === 'string' && val.itemId) || key
      const canon = canonicalItemId(itemsData, rawId)
      const qty = typeof val === 'number'
        ? Math.floor(val)
        : Math.floor(Number(val?.quantity) || 0)
      if (qty <= 0) continue
      const existing = merged[canon]
      const next = (existing?.quantity || 0) + qty
      merged[canon] = { itemId: canon, quantity: next }
    }
    save.bank = merged
  }
}

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
