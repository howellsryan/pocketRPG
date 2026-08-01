// Reconciling an idle/offline simulation's result with holdings that moved
// underneath it.
//
// The idle catch-up paths (visibility return, skip-1h) read equipment/inventory/
// bank from IndexedDB, simulate the elapsed window from that snapshot, then write
// the result back. They used to write the inventory and equipment back WHOLESALE
// while the bank was only ever adjusted by deltas. That asymmetry is what
// destroyed items: if the snapshot was behind live state — the save is written by
// a 300ms-debounced autosave, so anything the player did in the last moment before
// backgrounding the tab is still only in memory — the wholesale write reverted the
// inventory and equipment while the bank kept the removals. Anything that had just
// moved bank → inventory/equipment (a loadout preset moves the player's whole kit
// in one click) then existed in none of the three containers.
//
// The rule here: the simulation's INVENTORY and EQUIPMENT results are applied as
// the delta they actually produced, never as a write of the containers the
// simulation started from. When the snapshot matches live state — the
// overwhelmingly common case — the delta application is skipped entirely and the
// simulated container is returned verbatim, so this is a no-op on the happy path.
//
// The BANKED half (`bankedItems`/`chargesBanked`) is deliberately passed through
// unclamped, exactly as before this module existed: an auto-bank trip reports the
// whole pack it swept, so a player who manually banked the same items mid-window
// is credited twice. That is a pre-existing over-credit, not a loss, and fixing
// it means teaching the sims to report what they swept versus what they gained.
// Do not read the delta guarantee above as covering it.
//
// Reconciled GAINS are re-added in plain unnoted form (`inventoryDelta` keys on
// itemId alone). Harmless today because no idle sim produces noted items; a sim
// that starts to would need a noted-aware delta.
import { addItem, removeItem, freeSlots } from './inventory.js'
import { hardModeDeathLoss } from './hardMode.js'
import { INVENTORY_SIZE } from '../utils/constants.js'

function slotQuantity(slot) {
  if (!slot || !slot.itemId) return 0
  const qty = Number(slot.quantity)
  return Number.isFinite(qty) && qty > 0 ? qty : 1
}

/** Total quantity per itemId held in an inventory array. */
export function inventoryTotals(inventory) {
  const totals = {}
  for (const slot of Array.isArray(inventory) ? inventory : []) {
    const qty = slotQuantity(slot)
    if (qty > 0) totals[slot.itemId] = (totals[slot.itemId] || 0) + qty
  }
  return totals
}

/** Net per-itemId change going from `base` to `next`. Zero entries are omitted. */
export function inventoryDelta(base, next) {
  const from = inventoryTotals(base)
  const to = inventoryTotals(next)
  const delta = {}
  for (const itemId of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const change = (to[itemId] || 0) - (from[itemId] || 0)
    if (change !== 0) delta[itemId] = change
  }
  return delta
}

/**
 * True when two inventories hold the same items in the same slots. Compared
 * slot-by-slot rather than by totals: a same-totals-different-slots inventory
 * still means something moved, and re-slotting the player's pack from under them
 * is exactly what we are trying to stop.
 */
export function sameInventory(a, b) {
  const left = Array.isArray(a) ? a : []
  const right = Array.isArray(b) ? b : []
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const l = left[i]
    const r = right[i]
    if (!l && !r) continue
    if (!l || !r) return false
    if (l.itemId !== r.itemId) return false
    if (slotQuantity(l) !== slotQuantity(r)) return false
    if (!!l.noted !== !!r.noted) return false
    // Charges too: a slot whose ONLY difference is its charge value has still
    // moved, and taking the happy path would write the snapshot's value back.
    if ((Number(l.charges) || 0) !== (Number(r.charges) || 0)) return false
  }
  return true
}

// Charges carried by the simulation's copy of an item, and only when it produced
// exactly one copy: charges are per-instance, so stamping one value onto several
// copies would mint charges out of nothing.
function soleCharges(simulated, itemId) {
  let found = null
  for (const slot of Array.isArray(simulated) ? simulated : []) {
    if (!slot || slot.itemId !== itemId) continue
    if (found) return 0
    found = slot
  }
  return Math.max(0, Math.floor(Number(found?.charges) || 0))
}

/**
 * Fold a simulation's inventory result into the live inventory.
 *
 * @param {object}   args
 * @param {Array}    args.base       inventory the simulation started from
 * @param {Array}    args.simulated  inventory the simulation produced
 * @param {Array}    args.live       inventory as it stands right now
 * @param {object}   args.itemsData  item table (for stackability)
 * @returns {{ inventory: Array, overflow: Record<string, number>, reconciled: boolean }}
 *   `overflow` is what could not fit and must go to the bank instead.
 */
export function reconcileIdleInventory({ base, simulated, live, itemsData = {} }) {
  const simulatedInv = Array.isArray(simulated) ? simulated : []
  // Nothing moved underneath the simulation — take its result as-is. This is the
  // happy path and must stay byte-for-byte identical to the old behaviour.
  if (sameInventory(base, live)) {
    return { inventory: simulatedInv, overflow: {}, reconciled: false }
  }

  // Slots are copied, not just the array: removeItem decrements `quantity` in
  // place, and these entry objects are the ones live state still holds.
  const inventory = (Array.isArray(live) ? live : [])
    .slice(0, INVENTORY_SIZE)
    .map((slot) => (slot ? { ...slot } : null))
  while (inventory.length < INVENTORY_SIZE) inventory.push(null)

  const delta = inventoryDelta(base, simulatedInv)
  const overflow = {}

  // Removals first so consumed supplies free the slots the gains need.
  for (const [itemId, change] of Object.entries(delta)) {
    if (change >= 0) continue
    removeItem(inventory, itemId, Math.min(-change, inventoryTotals(inventory)[itemId] || 0))
  }
  for (const [itemId, change] of Object.entries(delta)) {
    if (change <= 0) continue
    const stackable = !!itemsData?.[itemId]?.stackable
    const filledBefore = inventory.map((slot) => !!slot)
    // addItem is all-or-nothing for a stackable (one slot, or merged into the
    // existing stack) but NOT for a non-stackable: it fills free slots one at a
    // time and reports failure only once it runs out, leaving what it already
    // placed behind. Taking that `false` as "none of it landed" and sending the
    // whole gain to the bank is how the pack keeps copies the bank is also
    // credited for — so the placeable count is decided up front.
    let placed = 0
    if (stackable) {
      if (addItem(inventory, itemId, change, true)) placed = change
    } else {
      placed = Math.min(change, freeSlots(inventory))
      if (placed > 0) addItem(inventory, itemId, placed, false)
    }
    if (placed < change) overflow[itemId] = (overflow[itemId] || 0) + (change - placed)
    if (placed <= 0) continue

    const charges = placed === 1 ? soleCharges(simulatedInv, itemId) : 0
    if (charges > 0) {
      const landed = inventory.findIndex((slot, i) => !filledBefore[i] && slot?.itemId === itemId)
      if (landed !== -1) inventory[landed] = { ...inventory[landed], charges }
    }
  }

  return { inventory, overflow, reconciled: true }
}

/**
 * The full set of holdings writes an idle/offline simulation result implies,
 * resolved against live state. Both catch-up call sites (visibility return,
 * skip-1h) go through this so they cannot drift apart.
 *
 * `hardModeDeath` folds the death penalty INTO this write rather than leaving
 * the caller to apply it afterwards: a second write would race the reconcile
 * that just resolved these three containers against live state (§4). Loot
 * already banked during the window is kept — the bank is never at risk in hard
 * mode, only what the player was carrying when they went down.
 *
 * @returns {{
 *   inventory: Array,                    // write wholesale
 *   bankDeltas: Record<string, number>,  // apply as deltas (never wholesale)
 *   equipment: object|null,              // write only when non-null
 *   reconciled: boolean,                 // true when live had moved under the sim
 *   hardModeItemsLost: Array|null,       // tally for the idle-result modal
 * }}
 */
export function resolveIdleHoldingsWrites({ base, sim, live, itemsData = {}, bankedItems = {}, ammoConsumed = null, chargesConsumed = 0, hardModeDeath = false }) {
  const { inventory, overflow, reconciled } = reconcileIdleInventory({
    base: base?.inventory,
    simulated: sim?.finalInventory,
    live: live?.inventory,
    itemsData,
  })
  const bankDeltas = { ...bankedItems }
  // Gains that no longer fit the live pack go to the bank rather than nowhere.
  for (const [itemId, qty] of Object.entries(overflow)) {
    bankDeltas[itemId] = (bankDeltas[itemId] || 0) + qty
  }
  const equipment = applyIdleEquipmentWear(live?.equipment, {
    baseEquipment: base?.equipment,
    ammoConsumed,
    chargesConsumed,
  })
  if (hardModeDeath) {
    const loss = hardModeDeathLoss(inventory, equipment || live?.equipment, itemsData)
    return { inventory: loss.inventory, bankDeltas, equipment: loss.equipment, reconciled, hardModeItemsLost: loss.lost }
  }
  return { inventory, bankDeltas, equipment, reconciled, hardModeItemsLost: null }
}

/**
 * Apply an idle simulation's equipment wear (ammo spent, weapon charges burned)
 * to the LIVE equipment rather than writing back the snapshot the simulation
 * started from. Each effect is gated on the live slot still holding the item the
 * simulation was wearing — a slot the player has since changed keeps its new
 * contents instead of being reverted.
 *
 * @returns {object|null} the next equipment object, or null when nothing changed.
 */
export function applyIdleEquipmentWear(liveEquipment, { baseEquipment = {}, ammoConsumed = null, chargesConsumed = 0 } = {}) {
  const live = liveEquipment || {}
  let next = null
  const mutate = () => (next = next || { ...live })

  const spent = Math.max(0, Math.floor(Number(ammoConsumed?.quantity) || 0))
  if (spent > 0 && ammoConsumed?.itemId && live.ammo?.itemId === ammoConsumed.itemId) {
    const remaining = Math.max(0, (Number(live.ammo.quantity) || 0) - spent)
    mutate()
    next.ammo = remaining > 0 ? { ...live.ammo, quantity: remaining } : null
  }

  const burned = Math.max(0, Math.floor(Number(chargesConsumed) || 0))
  if (burned > 0 && live.weapon?.itemId && live.weapon.itemId === baseEquipment?.weapon?.itemId) {
    mutate()
    next.weapon = { ...live.weapon, charges: Math.max(0, (Number(live.weapon.charges) || 0) - burned) }
  }

  return next
}
