import itemsData from '../data/items.json'

/**
 * A monster/boss/raid drop of MORE THAN ONE non-stackable item arrives as a
 * note: one inventory slot instead of N. Stackables already coalesce into a
 * single slot, so noting them would only make them unusable for nothing.
 *
 * A rolled quantity of 1 is never noted — a lone note is strictly worse than
 * the item (it can't be eaten, drunk or equipped until it's been banked), and
 * the rule exists to stop a five-item drop eating five slots, not to convert
 * every drop into paperwork.
 *
 * The decision keys off the ROLLED quantity, not the authored range, so a
 * `[1, 3]` drop hands over a real item on a 1 and a note on a 2 or 3.
 *
 * `items` defaults to the real table because the loot rollers in combat.js sit
 * below `processCombatTick`'s `itemsData` argument (`applyInstantKill` has no
 * such argument at all), and threading one through every death path to reach
 * a single stackable lookup buys nothing.
 */
export function dropArrivesNoted(itemId, quantity, items = itemsData) {
  if (typeof itemId !== 'string' || !itemId) return false
  if (Math.floor(Number(quantity) || 0) < 2) return false
  return items?.[itemId]?.stackable !== true
}

/**
 * Stamp `noted` onto the entries of a rolled loot list that qualify. An entry
 * already authored `noted: true` keeps it at any quantity — the drop table's
 * explicit choice outranks the quantity rule.
 */
export function applyNotedDrops(loot, items = itemsData) {
  if (!Array.isArray(loot)) return loot
  return loot.map((entry) => (
    entry && !entry.noted && dropArrivesNoted(entry.itemId, entry.quantity, items)
      ? { ...entry, noted: true }
      : entry
  ))
}
