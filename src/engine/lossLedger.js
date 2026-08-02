// The declared item-loss ledger (Phase 3 of the item-loss safety net — see
// docs/item-loss-safety-net.md).
//
// The Phase 2 detector measures what a save write DESTROYS across bank ∪
// inventory ∪ equipment. It cannot tell an infusion spending 40,000 platebodies
// from a bug eating them, so ordinary production idling flagged on essentially
// every save and buried the flags worth reading.
//
// The asymmetry that fixes it: every DELIBERATE removal goes through an itemised
// engine mutator, and a bug — the loadout preset that wrote a stale container
// wholesale — goes through none. So deliberate removals record here, the ledger
// ships alongside the save, and the server nets it off before thresholding.
// Whatever is left over is, by construction, unexplained.
//
// This ledger only ever makes the server report LESS. It is not a permission and
// nothing is rejected on the strength of it, so a gap in coverage costs a noisy
// flag, never a blocked save.

// Window semantics: the ledger covers everything spent since the write the
// SERVER last stored, which is what the detector compares against. So it is
// settled by subtraction on a successful push (not cleared — more may have been
// spent while that push was on the wire), retained on a failed one so the retry
// still covers the wider window, and reset outright whenever we adopt a server
// copy, because from that point it describes a window already superseded.
const STORAGE_KEY = 'pocketrpg_loss_ledger'

// A save window spends a handful of distinct materials. This is a bound on
// malformed state, and overflow simply stops declaring — which flags MORE.
const MAX_LEDGER_ITEMS = 256

let ledger = new Map()
let hydrated = false

function persist() {
  if (typeof localStorage === 'undefined') return
  try {
    if (ledger.size === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(ledger)))
  } catch { /* non-fatal: the ledger is an optimisation, never a correctness need */ }
}

// A reload drops module state but not the pending progress it described, so the
// ledger is read back once on first use.
function hydrate() {
  if (hydrated) return
  hydrated = true
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return
    for (const [itemId, qty] of Object.entries(parsed)) addTo(itemId, qty)
  } catch { /* corrupt entry: start clean rather than fail the boot */ }
}

function addTo(itemId, quantity) {
  const qty = Math.floor(Number(quantity) || 0)
  if (qty <= 0) return false
  if (typeof itemId !== 'string' || !itemId) return false
  if (!ledger.has(itemId) && ledger.size >= MAX_LEDGER_ITEMS) return false
  ledger.set(itemId, (ledger.get(itemId) || 0) + qty)
  return true
}

/**
 * Declare a deliberate removal. Call from the itemised mutators only — never
 * from a path that replaces a whole container, which is the shape of the bug
 * this exists to keep visible.
 *
 * @param {Record<string, number>} items itemId -> POSITIVE quantity removed
 */
export function recordItemLosses(items) {
  if (!items || typeof items !== 'object') return
  hydrate()
  let changed = false
  for (const [itemId, qty] of Object.entries(items)) {
    if (addTo(itemId, qty)) changed = true
  }
  if (changed) persist()
}

/**
 * As recordItemLosses, for the `[{ itemId, quantity }]` tally shape the engine
 * hands back when a removal is also shown to the player — a hard-mode death
 * names what it took, so the loss arrives as a list rather than a map.
 *
 * @param {Array<{itemId: string, quantity: number}>} entries
 */
export function recordItemLossEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return
  const items = {}
  for (const entry of entries) {
    const itemId = entry?.itemId
    if (typeof itemId !== 'string' || !itemId) continue
    items[itemId] = (items[itemId] || 0) + (Math.floor(Number(entry.quantity) || 0) || 1)
  }
  recordItemLosses(items)
}

/** Everything declared since the server last stored a write, or null if nothing
 * has been. Null rather than {} so the push omits the field entirely. */
export function readItemLossLedger() {
  hydrate()
  if (ledger.size === 0) return null
  return Object.fromEntries(ledger)
}

/**
 * A push carrying `shipped` landed. Subtract it rather than clearing: the push
 * was on the wire for a round trip, and anything spent in that window belongs to
 * the NEXT save's ledger, not this one's.
 */
export function settleItemLossLedger(shipped) {
  if (!shipped || typeof shipped !== 'object') return
  hydrate()
  for (const [itemId, qty] of Object.entries(shipped)) {
    const remaining = (ledger.get(itemId) || 0) - (Math.floor(Number(qty) || 0))
    if (remaining > 0) ledger.set(itemId, remaining)
    else ledger.delete(itemId)
  }
  persist()
}

/** Drop the ledger — on adopting a server copy, logout, or character switch. */
export function resetItemLossLedger() {
  hydrated = true
  ledger = new Map()
  persist()
}
