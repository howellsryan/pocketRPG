/**
 * teleports — magic teleportation between world-map places.
 *
 * Every place in src/data/world.json carries a `teleport: { level, xp, runes }`
 * definition: cities are cheap and low-level (RS-style), smaller settlements need
 * higher Magic and costlier runes. Casting is instant (no task), consumes runes
 * inventory-first-then-bank, and grants Magic XP — the same rune semantics as
 * spellcasting (an equipped elemental staff supplies its element for free via
 * getRunesToConsume).
 *
 * Pure logic, no UI imports (engine layer — CLAUDE.md §3). The caller owns state:
 * apply `deductRunes` results, grant `xp`, move the player, and hand any active
 * journey to `teleportIntoJourney` (engine/journeys.js) to skip/re-plan its leg.
 */
import { getPlace } from './world.js'
import { getRunesToConsume } from './runes.js'
import { countItem, removeItem } from './inventory.js'

/** The place's teleport definition, or null if it has none. */
export function getTeleport(placeId) {
  return getPlace(placeId)?.teleport || null
}

/**
 * Can the player cast this teleport right now?
 * Returns { ok, level, xp, runes, reason } — `runes` is what would actually be
 * consumed (staff-provided elements excluded), `reason` a user-facing string
 * when !ok.
 */
export function teleportCheck(placeId, { magicLevel, inventory = [], bank = {}, equipment = null, itemsData = {} }) {
  const tp = getTeleport(placeId)
  if (!tp) return { ok: false, reason: 'No teleport reaches this place.' }
  const runes = getRunesToConsume(tp.runes, equipment, itemsData)
  if ((magicLevel || 1) < tp.level) {
    return { ok: false, level: tp.level, xp: tp.xp, runes, reason: `Requires Magic ${tp.level}.` }
  }
  for (const [runeId, qty] of Object.entries(runes)) {
    const have = countItem(inventory, runeId) + (bank?.[runeId]?.quantity || 0)
    if (have < qty) {
      const name = itemsData?.[runeId]?.name || runeId
      return { ok: false, level: tp.level, xp: tp.xp, runes, reason: `Not enough runes — need ${qty}× ${name}.` }
    }
  }
  return { ok: true, level: tp.level, xp: tp.xp, runes }
}

/**
 * Plan the rune deductions for a cast: inventory first, then bank (the same
 * order spellcasting uses). Returns { inventory, bankUpdates } — a new inventory
 * array plus negative bank deltas for updateBankDirect — or null if the runes
 * aren't there. Does not mutate the passed inventory.
 */
export function deductRunes(runes, inventory) {
  const newInv = inventory.map((slot) => (slot ? { ...slot } : null))
  const bankUpdates = {}
  for (const [runeId, qty] of Object.entries(runes || {})) {
    const fromInv = Math.min(countItem(newInv, runeId), qty)
    const fromBank = qty - fromInv
    if (fromInv > 0 && !removeItem(newInv, runeId, fromInv)) return null
    if (fromBank > 0) bankUpdates[runeId] = -fromBank
  }
  return { inventory: newInv, bankUpdates }
}

/** Compact "1× Law, 3× Air" cost string for buttons/tooltips. */
export function formatRuneCost(runes, itemsData = {}) {
  return Object.entries(runes || {})
    .map(([runeId, qty]) => `${qty}× ${(itemsData?.[runeId]?.name || runeId).replace(/ Rune$/i, '')}`)
    .join(', ')
}
