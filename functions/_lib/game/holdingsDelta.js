import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { canonicalItemId } from './inventory.js'

// Item-loss detector (Phase 2 of the item-loss safety net — see
// docs/item-loss-safety-net.md). Measures what a save write is about to
// DESTROY, as opposed to move.
//
// The pre-existing guard this sits alongside (detectBankWipe in
// saveValidation.js) only ever fired on a near-total wipe of distinct bank
// item IDS. That missed the incident it was written for twice over: half a
// bank is 50% of the ids, well under its 90% trigger, and because it counts ids
// rather than units a 10,000 → 1 stack collapse is invisible to it. This module
// is quantity-aware, covers all three containers, and runs on EVERY server-side
// save writer rather than just /api/save.
//
// It rejects nothing. It reports, so the write can be audited and the
// overwritten blob preserved (functions/_lib/game/saveHistory.js). Enforcement
// needs a client-side loss ledger to tell a legitimate bulk consume from a bug,
// and that is Phase 3.

// Bulk-churn item types. Idle catch-up, combat and skilling legitimately burn
// these by the thousand inside a single 120s save window, so they carry a
// value-based threshold rather than a unit count. Anything not listed here is
// DURABLE — gear, tools and materials, which a player parts with a few at a
// time and deliberately. `type` is the right axis and `stackable` is not: food
// and materials are non-stackable but consumed in bulk, ammo and runes are
// stackable but pure consumables.
const RESOURCE_TYPES = new Set([
  'ammo', 'currency', 'food', 'junk', 'potion', 'quest', 'resource', 'rune', 'seed',
])

// Coins move constantly and legitimately (every purchase, every shop sale, the
// trading post), and at a scale that would swamp any value threshold they were
// counted in. Tracked as their own scalar so the audit still records them.
const COINS_ITEM_ID = 'coins'

// Two durable items is the smallest loss worth a second look, but on its own it
// is also a player selling a pair of old platebodies — so a flag needs value
// behind it, or enough units that no deliberate act explains them.
export const DURABLE_UNITS_FLOOR = 2
export const DURABLE_VALUE_FLOOR = 50_000
export const DURABLE_BULK_UNITS_FLOOR = 6
// A day of idle catch-up burns a lot of supplies; it does not burn a million gp
// of them.
export const RESOURCE_VALUE_FLOOR = 1_000_000

// How many per-item rows ride the audit payload. Enough to recognise what went
// missing without putting a whole bank in the audit table.
const MAX_REPORTED_ITEMS = 12

function addUnits(map, rawId, quantity, itemsTable) {
  const qty = Math.floor(Number(quantity) || 0)
  if (qty <= 0) return
  const id = canonicalItemId(itemsTable, rawId)
  if (typeof id !== 'string' || !id) return
  map.set(id, (map.get(id) || 0) + qty)
}

function addCharges(map, rawId, charges, itemsTable) {
  const value = Math.floor(Number(charges) || 0)
  if (value <= 0) return
  const id = canonicalItemId(itemsTable, rawId)
  if (typeof id !== 'string' || !id) return
  map.set(id, (map.get(id) || 0) + value)
}

/**
 * Every item unit the save holds anywhere, keyed by CANONICAL id, plus the
 * charge pool per item. Holdings balance as a SET across bank/inventory/
 * equipment (CLAUDE.md §4) — items MOVE between the three, so measuring one
 * container alone reads every deposit as a theft.
 *
 * Strictly read-only: getInventory() in inventory.js
 * normalises the save in place, and a detector must never mutate what it is
 * measuring — least of all the "previous" save, which is the record we compare
 * everything else against.
 */
export function holdingsOf(save, itemsTable = itemsData) {
  const units = new Map()
  const charges = new Map()
  if (!save || typeof save !== 'object') return { units, charges }

  const bank = save.bank
  if (bank && typeof bank === 'object') {
    for (const key of Object.keys(bank)) {
      const entry = bank[key]
      if (typeof entry === 'number') {
        addUnits(units, key, entry, itemsTable)
        continue
      }
      if (!entry || typeof entry !== 'object') continue
      const id = typeof entry.itemId === 'string' && entry.itemId ? entry.itemId : key
      addUnits(units, id, entry.quantity, itemsTable)
      addCharges(charges, id, entry.charges, itemsTable)
    }
  }

  const inventory = save.inventory
  if (Array.isArray(inventory)) {
    for (const slot of inventory) {
      if (!slot || typeof slot !== 'object') continue
      const id = (typeof slot.itemId === 'string' && slot.itemId)
        ? slot.itemId
        : (typeof slot.id === 'string' ? slot.id : null)
      if (!id) continue
      addUnits(units, id, slot.quantity, itemsTable)
      addCharges(charges, id, slot.charges, itemsTable)
    }
  }

  const equipment = save.equipment
  if (equipment && typeof equipment === 'object') {
    for (const slot of Object.keys(equipment)) {
      const entry = equipment[slot]
      if (!entry || typeof entry !== 'object') continue
      const id = typeof entry.itemId === 'string' && entry.itemId ? entry.itemId : null
      if (!id) continue
      // Ammo is the one equipment slot that carries a stack; everything else is
      // a single worn piece whose quantity field may be absent.
      const quantity = Number(entry.quantity)
      addUnits(units, id, Number.isFinite(quantity) && quantity > 0 ? quantity : 1, itemsTable)
      addCharges(charges, id, entry.charges, itemsTable)
    }
  }

  return { units, charges }
}

/** What a save is holding, for a human deciding whether it is the snapshot they
 * want to restore. Value-ordered, because "is my scythe in this one" is the
 * question being asked. */
export function summariseHoldings(save, itemsTable = itemsData) {
  const { units } = holdingsOf(save, itemsTable)
  let totalUnits = 0
  const items = []
  for (const [itemId, quantity] of units) {
    totalUnits += quantity
    items.push({ itemId, quantity, value: unitValue(itemId, itemsTable) * quantity })
  }
  items.sort((a, b) => (b.value - a.value) || (b.quantity - a.quantity))
  return { distinctItems: items.length, totalUnits, topItems: items.slice(0, MAX_REPORTED_ITEMS) }
}

// Holdings measured at load time, keyed by the save object the loader handed
// out. A WeakMap rather than a field on the save because the save is serialised
// straight to D1 — anything hung on it becomes part of the blob. We store the
// COMPUTED holdings, not a reference to the save: every server-side writer
// mutates its save in place, so a reference would only ever read back the
// post-mutation state and every delta would be zero.
const holdingsBaselines = new WeakMap()

export function rememberHoldingsBaseline(saveObject, itemsTable = itemsData) {
  if (!saveObject || typeof saveObject !== 'object') return
  holdingsBaselines.set(saveObject, holdingsOf(saveObject, itemsTable))
}

export function readHoldingsBaseline(saveObject) {
  if (!saveObject || typeof saveObject !== 'object') return null
  return holdingsBaselines.get(saveObject) || null
}

export function isResourceItem(itemId, itemsTable = itemsData) {
  const item = Object.prototype.hasOwnProperty.call(itemsTable || {}, itemId)
    ? itemsTable[itemId]
    : null
  const type = typeof item?.type === 'string' ? item.type : null
  if (type) return RESOURCE_TYPES.has(type)
  // Unknown item (content removed, or a save carrying an id we no longer ship):
  // fall back to the coarse axis. Equippable → durable, stackable → resource.
  if (item?.slot) return false
  return item?.stackable === true
}

function unitValue(itemId, itemsTable) {
  const item = Object.prototype.hasOwnProperty.call(itemsTable || {}, itemId)
    ? itemsTable[itemId]
    : null
  const value = Number(item?.shopValue)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * What `nextSave` destroys relative to `previousSave`. A unit that merely moved
 * between containers is not a loss; a unit that left all three is.
 *
 * Both sides are canonicalised first, so the legacy→canonical id rewrite
 * (normalizeSaveItemIds) reads as the same item rather than as one item
 * vanishing and another appearing.
 */
export function classifyItemLoss(previousSave, nextSave, itemsTable = itemsData) {
  return classifyItemLossFromHoldings(holdingsOf(previousSave, itemsTable), nextSave, itemsTable)
}

/** As classifyItemLoss, but from holdings captured EARLIER. Server-side writers
 * mutate the loaded save in place, so by the time the write happens the "before"
 * is already gone — it has to be measured at load time and carried. */
export function classifyItemLossFromHoldings(previous, nextSave, itemsTable = itemsData) {
  const next = holdingsOf(nextSave, itemsTable)

  let durableUnits = 0
  let durableValue = 0
  let resourceUnits = 0
  let resourceValue = 0
  let coinsLost = 0
  let chargesLost = 0
  const items = []

  for (const [itemId, before] of previous.units) {
    const lost = before - (next.units.get(itemId) || 0)
    if (lost <= 0) continue
    if (itemId === COINS_ITEM_ID) {
      coinsLost += lost
      continue
    }
    const value = unitValue(itemId, itemsTable) * lost
    if (isResourceItem(itemId, itemsTable)) {
      resourceUnits += lost
      resourceValue += value
    } else {
      durableUnits += lost
      durableValue += value
    }
    items.push({ itemId, lost, value })
  }

  for (const [itemId, before] of previous.charges) {
    const lost = before - (next.charges.get(itemId) || 0)
    if (lost > 0) chargesLost += lost
  }

  const reasons = []
  if (durableUnits >= DURABLE_UNITS_FLOOR &&
      (durableValue >= DURABLE_VALUE_FLOOR || durableUnits >= DURABLE_BULK_UNITS_FLOOR)) {
    reasons.push('durable_items')
  }
  if (resourceValue >= RESOURCE_VALUE_FLOOR) reasons.push('resource_value')

  items.sort((a, b) => (b.value - a.value) || (b.lost - a.lost))

  return {
    flagged: reasons.length > 0,
    reasons,
    durableUnits,
    durableValue,
    resourceUnits,
    resourceValue,
    coinsLost,
    chargesLost,
    distinctItemsLost: items.length,
    items: items.slice(0, MAX_REPORTED_ITEMS),
  }
}
