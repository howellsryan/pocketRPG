// What charging an item actually spends.
//
// Split from the charge UI (getChargeRecipe in components/WeaponChargePanel.jsx,
// which resolves the per-charge recipe) because both the Inventory and the
// Equipment screen consume it, and because the item-loss detector needs the
// tally as data: charge materials are `resource`-typed and cheap per unit, so a
// single "+All" on a stack of Shardglass Shards clears the detector's million-gp
// resource floor on its own and reads as an incident unless it is declared
// (src/engine/lossLedger.js).
//
// Pure logic, no UI imports.

/**
 * The itemised cost of adding `charges` charges, given a resolved per-charge
 * recipe. Summed per item id, so a recipe naming the same material twice is
 * counted twice rather than overwritten.
 *
 * @param {Array<{itemId: string, qty: number}>} recipe per-CHARGE cost
 * @param {number} charges how many charges are being added
 * @returns {Record<string, number>} itemId -> units consumed
 */
export function chargeRecipeSpend(recipe, charges) {
  const count = Math.max(0, Math.floor(Number(charges) || 0))
  const spend = {}
  if (count === 0 || !Array.isArray(recipe)) return spend
  for (const entry of recipe) {
    const itemId = entry?.itemId
    if (typeof itemId !== 'string' || !itemId) continue
    const per = Math.max(1, Math.floor(Number(entry.qty) || 1))
    spend[itemId] = (spend[itemId] || 0) + per * count
  }
  return spend
}
