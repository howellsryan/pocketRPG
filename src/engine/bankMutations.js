// Bank delta application, extracted from gameState's updateBankDirect so the
// semantics are testable and so the state layer can compute the next bank
// synchronously (it must, to persist the true current bank without waiting for a
// render to commit).
//
// §4: an entry's `charges` pools every copy of that item. Deltas ADD charges onto
// the pool; they never replace it, and an absent charge value means "this delta
// had nothing to say about charges", never zero.

/**
 * Apply per-itemId quantity deltas to a bank, returning a new bank object.
 * A delta that takes an entry to zero or below removes it. Negative deltas for
 * an item the bank does not hold are ignored — the bank cannot go negative.
 *
 * @param {Record<string, any>} bank
 * @param {Record<string, number>} itemUpdates  itemId -> signed quantity change
 * @param {Record<string, number>|null} charges itemId -> charges to pool on
 */
export function applyBankDeltas(bank, itemUpdates, charges = null) {
  const next = { ...(bank || {}) }
  for (const [itemId, rawQty] of Object.entries(itemUpdates || {})) {
    const qty = Math.floor(Number(rawQty) || 0)
    if (next[itemId]) {
      const newQty = (Number(next[itemId].quantity) || 0) + qty
      if (newQty <= 0) delete next[itemId]
      else next[itemId] = { ...next[itemId], quantity: newQty }
    } else if (qty > 0) {
      next[itemId] = { itemId, quantity: qty }
    }
    const incoming = Math.max(0, Math.floor(Number(charges?.[itemId]) || 0))
    if (incoming > 0 && next[itemId]) {
      const pooled = Math.max(0, Math.floor(Number(next[itemId].charges) || 0))
      next[itemId] = { ...next[itemId], charges: pooled + incoming }
    }
  }
  return next
}

/**
 * Units a delta actually took OUT of the bank, keyed by itemId — the declared
 * half of the item-loss ledger (src/engine/lossLedger.js).
 *
 * Read off the resulting banks rather than off the delta, because a negative
 * delta is a request, not an outcome: applyBankDeltas floors an entry at removal
 * and ignores a debit against an item the bank does not hold, so the delta
 * routinely asks for more than it gets. Declaring the request would over-declare
 * and let a genuine loss of the same item hide behind it.
 *
 * @param {Record<string, any>} before
 * @param {Record<string, any>} after
 * @param {Record<string, number>} itemUpdates the deltas that produced `after`
 * @returns {Record<string, number>} itemId -> POSITIVE units removed
 */
export function bankUnitsRemoved(before, after, itemUpdates) {
  const removed = {}
  for (const [itemId, rawQty] of Object.entries(itemUpdates || {})) {
    if ((Math.floor(Number(rawQty) || 0)) >= 0) continue
    const had = Math.max(0, Math.floor(Number(before?.[itemId]?.quantity) || 0))
    const has = Math.max(0, Math.floor(Number(after?.[itemId]?.quantity) || 0))
    if (had > has) removed[itemId] = had - has
  }
  return removed
}
