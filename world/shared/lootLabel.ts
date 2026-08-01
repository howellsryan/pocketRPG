/**
 * How a floor pile reads in the take menu and the hover text.
 *
 * A count only ever appears on a real stack: the server splits a non-stackable
 * drop into one entity per unit (server/loot.ts spawnDrops), so three sharks are
 * three rows the player can take one at a time rather than one "Take Shark" that
 * silently means three. That makes `qty > 1` equivalent to "stackable" here, and
 * this module needs no item table to decide.
 */
export function lootLabel(name: string, qty: number): string {
  return qty > 1 ? `${name} (${qty.toLocaleString()})` : name
}
