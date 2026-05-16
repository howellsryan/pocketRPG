import { GameApiError } from './errors.js'

const COIN_ITEM_ID = 'coins'
const INVENTORY_MAX_SLOTS = 28

function getInventoryArray(save) {
  return Array.isArray(save?.inventory) ? save.inventory : null
}

function getBankCoinQty(save) {
  const raw = save?.bank?.coins
  if (typeof raw === 'number') return Math.floor(raw)
  return Math.floor(Number(raw?.quantity) || 0)
}

function setBankCoinQty(save, qty) {
  const n = Math.floor(Number(qty) || 0)
  if (n <= 0) {
    if (save?.bank && Object.prototype.hasOwnProperty.call(save.bank, COIN_ITEM_ID)) {
      delete save.bank[COIN_ITEM_ID]
    }
    return
  }
  if (!save.bank || typeof save.bank !== 'object') save.bank = {}
  save.bank[COIN_ITEM_ID] = { itemId: COIN_ITEM_ID, quantity: n }
}

// Sum every coin source visible to the client: legacy top-level `save.coins`
// (older server writes), inventory slots whose itemId is 'coins', and bank
// coins.
export function getCoinTotal(save) {
  let total = Math.floor(Number(save?.coins) || 0)
  const inv = getInventoryArray(save)
  if (inv) {
    for (const slot of inv) {
      if (slot?.itemId === COIN_ITEM_ID) total += Math.floor(Number(slot.quantity) || 0)
    }
  }
  total += getBankCoinQty(save)
  return total
}

// Add coins the same way the client lays them out: coalesce into the existing
// inventory coin slot, else use an empty slot, else spill to bank.
export function addCoins(save, amount) {
  const n = Math.floor(Number(amount) || 0)
  if (n <= 0) return
  const inv = getInventoryArray(save)
  if (inv) {
    const existing = inv.find((s) => s?.itemId === COIN_ITEM_ID)
    if (existing) {
      existing.quantity = Math.floor(Number(existing.quantity) || 0) + n
      return
    }
    const emptyIdx = inv.findIndex((s) => !s || typeof s !== 'object' || !s.itemId)
    if (emptyIdx !== -1) {
      inv[emptyIdx] = { itemId: COIN_ITEM_ID, quantity: n }
      return
    }
    if (inv.length < INVENTORY_MAX_SLOTS) {
      inv.push({ itemId: COIN_ITEM_ID, quantity: n })
      return
    }
  }
  setBankCoinQty(save, getBankCoinQty(save) + n)
}

export function subtractCoins(save, amount) {
  const n = Math.floor(Number(amount) || 0)
  if (n <= 0) throw new GameApiError('INVALID_AMOUNT', 'Invalid amount', 400)
  const total = getCoinTotal(save)
  if (total < n) throw new GameApiError('INSUFFICIENT_COINS', 'Insufficient coins', 400)

  let remaining = n

  // Drain legacy top-level field first so older saves phase out cleanly.
  const legacy = Math.floor(Number(save?.coins) || 0)
  if (legacy > 0) {
    const take = Math.min(legacy, remaining)
    save.coins = legacy - take
    remaining -= take
  }
  if (remaining <= 0) return

  // Then inventory coin slots (back-to-front so splices don't shift indices).
  const inv = getInventoryArray(save)
  if (inv) {
    for (let i = inv.length - 1; i >= 0 && remaining > 0; i--) {
      const s = inv[i]
      if (!s || s.itemId !== COIN_ITEM_ID) continue
      const cur = Math.floor(Number(s.quantity) || 0)
      if (cur <= 0) continue
      const take = Math.min(cur, remaining)
      const next = cur - take
      if (next <= 0) inv.splice(i, 1)
      else s.quantity = next
      remaining -= take
    }
  }
  if (remaining <= 0) return

  const bankCoins = getBankCoinQty(save)
  if (bankCoins > 0) {
    setBankCoinQty(save, bankCoins - remaining)
  }
}
