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
