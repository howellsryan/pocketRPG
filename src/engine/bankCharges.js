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
