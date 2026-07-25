// Bank entries are keyed by itemId and pool the charges of every copy of that
// item in one `charges` scalar. Because entries get rebuilt from scratch all
// over the app (server loot grants, preset reshuffles, deposits), any rewrite
// that forgot the field used to destroy the pool silently — 20k trident
// charges gone with nothing to notice it.
//
// The invariant that closes the class: on a bank rewrite an ABSENT `charges`
// field means "this rewrite had nothing to say about charges", never "zero".
// Code that deliberately moves charges out of the bank must write an explicit
// number (0 included). Forgetting now preserves instead of destroying.

/**
 * Carry forward any charge pool the next bank state dropped without saying so.
 * Returns `nextBank` untouched (same reference) when nothing needed restoring.
 *
 * @param {Record<string, any>} prevBank bank state before the rewrite
 * @param {Record<string, any>} nextBank the rewritten bank
 */
export function preserveBankCharges(prevBank, nextBank) {
  if (!prevBank || !nextBank || typeof nextBank !== 'object') return nextBank
  let restored = null
  for (const [itemId, prevEntry] of Object.entries(prevBank)) {
    const prevCharges = Number(prevEntry?.charges) || 0
    if (prevCharges <= 0) continue
    const nextEntry = nextBank[itemId]
    if (!nextEntry || typeof nextEntry !== 'object') continue
    if (nextEntry.charges != null) continue
    if (!restored) restored = { ...nextBank }
    restored[itemId] = { ...nextEntry, charges: prevCharges }
  }
  return restored || nextBank
}

/**
 * Split a bank charge pool for a withdrawal: the withdrawn copies take their
 * proportional share (the whole pool when the entry empties), the bank keeps
 * the rest. Shared by the bank screen and the MCP withdraw intent so both
 * sides move charges by the same rule.
 */
export function splitBankCharges(poolCharges, withdrawQty, bankedQty) {
  const pool = Math.max(0, Math.floor(Number(poolCharges) || 0))
  const taking = Math.max(0, Math.floor(Number(withdrawQty) || 0))
  const banked = Math.max(0, Math.floor(Number(bankedQty) || 0))
  if (pool <= 0 || taking <= 0 || banked <= 0) return { taken: 0, remaining: pool }
  const taken = taking >= banked ? pool : Math.floor((pool * taking) / banked)
  return { taken, remaining: pool - taken }
}

/**
 * Spread `total` charges over `slotCount` withdrawn copies — even floor split
 * with the remainder on the last slot, so no charge is lost to rounding.
 */
export function distributeCharges(total, slotCount) {
  const amount = Math.max(0, Math.floor(Number(total) || 0))
  const slots = Math.max(0, Math.floor(Number(slotCount) || 0))
  if (slots <= 0) return []
  const per = Math.floor(amount / slots)
  return Array.from({ length: slots }, (_, i) => (i === slots - 1 ? amount - per * (slots - 1) : per))
}
