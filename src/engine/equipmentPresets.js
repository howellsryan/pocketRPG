// Equipment presets — saved equipment + inventory loadouts, the gear analogue of
// bank tabs. A preset is a portable snapshot of "what to wear and carry"; loading
// one re-arranges the items the character ALREADY owns (bank ⇄ inventory ⇄
// equipment). It never creates items: anything the preset asks for that the
// player lacks is reported back and the slot is left empty.
//
// Pure logic only — no UI imports — so it can be unit-tested and shared.
import { EQUIPMENT_SLOTS, INVENTORY_SIZE } from '../utils/constants.js'
import { checkEquipRequirements } from './equipment.js'

// Loadout slots every character starts with. Extra tabs are bought one at a
// time on the Character Unlocks screen (`extra_equipment_tab`, 10 credits each,
// no limit) and counted in the save's characterUnlocks — so the real cap is
// equipmentPresetLimit(), never this constant on its own.
export const MAX_EQUIPMENT_PRESETS = 3
const MAX_PRESET_NAME = 24

// How many loadout tabs this character may hold: the base three plus every
// extra tab purchased. Tolerates the pre-feature save shape (absent key = 0).
export function equipmentPresetLimit(characterUnlocks) {
  const extra = Math.floor(Number(characterUnlocks?.extraEquipmentTabs) || 0)
  return MAX_EQUIPMENT_PRESETS + Math.max(0, extra)
}

// ── Snapshot creation ────────────────────────────────────────────────────────
// Capture the fields needed to re-create each item (id, quantity, charges, noted).
// Transient flags like `_twoHanded` are intentionally dropped — they are
// recomputed from itemsData when the preset is applied.
export function snapshotPreset(equipment, inventory) {
  const eq = {}
  for (const slot of EQUIPMENT_SLOTS) {
    const e = equipment?.[slot]
    if (!e || !e.itemId) continue
    const entry = { itemId: e.itemId }
    if ((e.quantity || 0) > 1) entry.quantity = e.quantity
    if ((e.charges || 0) > 0) entry.charges = e.charges
    eq[slot] = entry
  }
  const inv = []
  const src = Array.isArray(inventory) ? inventory : []
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const s = src[i]
    if (!s || !s.itemId) { inv.push(null); continue }
    const entry = { itemId: s.itemId, quantity: s.quantity || 1 }
    if ((s.charges || 0) > 0) entry.charges = s.charges
    if (s.noted) entry.noted = true
    inv.push(entry)
  }
  return { equipment: eq, inventory: inv }
}

function sanitizeName(name, fallback = 'Preset') {
  const n = typeof name === 'string' ? name.trim() : ''
  return (n || fallback).slice(0, MAX_PRESET_NAME)
}

export function createPreset(name, equipment, inventory) {
  return {
    id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: sanitizeName(name),
    ...snapshotPreset(equipment, inventory),
  }
}

// Rename helper kept here so the name rules live in one place.
export function renamePreset(preset, name) {
  return { ...preset, name: sanitizeName(name, preset?.name) }
}

// ── Apply ────────────────────────────────────────────────────────────────────
// Build a mutable pool of every item the character currently holds (equipment +
// inventory + bank), keyed by itemId. `quantity` is the total count; `charges`
// holds the per-instance charge values so charged gear keeps its charges when
// drawn back out.
function buildPool(equipment, inventory, bank) {
  const pool = new Map()
  const add = (itemId, quantity, charges) => {
    const qty = Number(quantity) || 0
    if (!itemId || qty <= 0) return
    let p = pool.get(itemId)
    if (!p) { p = { quantity: 0, charges: [], charged: false }; pool.set(itemId, p) }
    p.quantity += qty
    if ((charges || 0) > 0) { p.charges.push(charges); p.charged = true }
  }
  for (const slot of EQUIPMENT_SLOTS) {
    const e = equipment?.[slot]
    if (e && e.itemId) add(e.itemId, e.quantity || 1, e.charges)
  }
  for (const s of (Array.isArray(inventory) ? inventory : [])) {
    if (s && s.itemId) add(s.itemId, s.quantity || 1, s.charges)
  }
  for (const [itemId, v] of Object.entries(bank || {})) {
    if (v) add(itemId, v.quantity || 0, v.charges)
  }
  return pool
}

// Draw up to `want` units of an item from the pool (mutates it). Returns
// { quantity, charges } where `charges` is the charge value carried by a single
// drawn unit (charged gear is always non-stackable). Prefers charged instances
// so charges land on the equipped/carried copy rather than being left in bank.
function drawFromPool(pool, itemId, want) {
  const p = pool.get(itemId)
  if (!p || p.quantity <= 0 || want <= 0) return { quantity: 0 }
  const got = Math.min(p.quantity, want)
  p.quantity -= got
  let charges
  if (p.charges.length > 0) charges = p.charges.shift()
  if (p.quantity <= 0 && p.charges.length === 0) pool.delete(itemId)
  return { quantity: got, charges }
}

/**
 * Apply a preset to a character's holdings.
 *
 * @returns {{
 *   equipment: object, inventory: Array, bank: object,
 *   missing: Array<{itemId, quantity}>,     // wanted but not owned at all
 *   partial: Array<{itemId, wanted, got}>,  // stackable: owned fewer than wanted
 *   reqFailed: Array<{itemId, reason}>,      // owned but level/quest req unmet
 * }}
 */
export function applyPreset(preset, state, itemsData, stats, completedQuests) {
  const { equipment = {}, inventory = [], bank = {} } = state || {}
  const pool = buildPool(equipment, inventory, bank)

  const newEquipment = {}
  const newInventory = new Array(INVENTORY_SIZE).fill(null)
  const missing = new Map()   // itemId -> shortfall qty (fully missing)
  const reqFailed = new Map()  // itemId -> reqError
  const partial = new Map()    // itemId -> { wanted, got }

  const noteMissing = (itemId, qty) => missing.set(itemId, (missing.get(itemId) || 0) + qty)
  const notePartial = (itemId, wanted, got) => {
    const cur = partial.get(itemId)
    if (cur) { cur.wanted += wanted; cur.got += got }
    else partial.set(itemId, { wanted, got })
  }

  // Equipment first — priority draws so a charged weapon, etc. is equipped before
  // a stray inventory copy in the snapshot would consume it.
  for (const slot of EQUIPMENT_SLOTS) {
    const want = preset?.equipment?.[slot]
    if (!want || !want.itemId) continue
    const item = itemsData?.[want.itemId]
    if (!item) continue
    const reqError = checkEquipRequirements(item, stats, completedQuests)
    if (reqError) {
      reqFailed.set(want.itemId, reqError) // leave empty; item returns to bank
      continue
    }
    const wantQty = (item.stackable || slot === 'ammo') ? Math.max(1, want.quantity || 1) : 1
    const drawn = drawFromPool(pool, want.itemId, wantQty)
    if (drawn.quantity <= 0) { noteMissing(want.itemId, wantQty); continue }
    const entry = { itemId: want.itemId, _twoHanded: item.twoHanded || false }
    if (item.stackable || slot === 'ammo') entry.quantity = drawn.quantity
    if (drawn.charges) entry.charges = drawn.charges
    newEquipment[slot] = entry
    if (drawn.quantity < wantQty) notePartial(want.itemId, wantQty, drawn.quantity)
  }

  // Inventory next — preserve the snapshot's slot positions.
  const presetInv = Array.isArray(preset?.inventory) ? preset.inventory : []
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const want = presetInv[i]
    if (!want || !want.itemId) continue
    const item = itemsData?.[want.itemId]
    if (!item) continue
    const wantQty = Math.max(1, want.quantity || 1)
    const drawn = drawFromPool(pool, want.itemId, wantQty)
    if (drawn.quantity <= 0) { noteMissing(want.itemId, wantQty); continue }
    const entry = { itemId: want.itemId, quantity: drawn.quantity }
    if (drawn.charges) entry.charges = drawn.charges
    if (want.noted) entry.noted = true
    newInventory[i] = entry
    if (drawn.quantity < wantQty) notePartial(want.itemId, wantQty, drawn.quantity)
  }

  // Everything still in the pool returns to the bank. Undrawn charges are
  // re-pooled in full (the bank holds one charge total per item), and an item
  // whose charges all went onto the player writes an explicit 0 — an absent
  // field means "untouched" to preserveBankCharges and would duplicate them.
  const newBank = {}
  for (const [itemId, p] of pool.entries()) {
    if (p.quantity <= 0) continue
    const entry = { itemId, quantity: p.quantity }
    if (p.charged) entry.charges = p.charges.reduce((sum, c) => sum + c, 0)
    newBank[itemId] = entry
  }

  return {
    equipment: newEquipment,
    inventory: newInventory,
    bank: newBank,
    missing: [...missing.entries()].map(([itemId, quantity]) => ({ itemId, quantity })),
    partial: [...partial.entries()].map(([itemId, v]) => ({ itemId, ...v })),
    reqFailed: [...reqFailed.entries()].map(([itemId, reason]) => ({ itemId, reason })),
  }
}
