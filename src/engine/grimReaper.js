/**
 * Grim Reaper: the buy-back for what a hard-mode death took.
 *
 * A death stashes its losses in `settings.grimReaper` (see hardMode.js's
 * `hardModeDeathLoss`/tally — charges included). One slot: a second hard-mode
 * death overwrites it outright, so an unclaimed stash is lost the moment
 * another hard fight kills you. Reclaiming is all-or-nothing — one price for
 * the whole stash, never a per-item pick.
 *
 * Pure logic, no UI imports. Shared by the client (pricing display) and the
 * server (functions/api/grim-reaper/reclaim.js, the only place that actually
 * spends credits or grants items).
 */
import { getLootTotalValue } from '../utils/itemValue.js'

/** 5,000,000 gp of lost value per credit, rounded up, floor of 1. */
export const GRIM_REAPER_GP_PER_CREDIT = 5_000_000

/**
 * Credits to reclaim a stash. `items` is the same shape `hardModeDeathLoss`
 * returns: `[{ itemId, quantity, charges? }]`. An empty/missing stash costs
 * nothing because there is nothing to buy back; any non-empty stash costs at
 * least 1 credit even if every item in it happens to be worthless — dying
 * hard mode with trash in your pack is still a death.
 */
export function grimReaperCost(items, itemsData) {
  if (!Array.isArray(items) || items.length === 0) return 0
  const totalValue = getLootTotalValue(items, itemsData)
  return Math.max(1, Math.ceil(totalValue / GRIM_REAPER_GP_PER_CREDIT))
}

/**
 * Builds the stash a hard-mode death writes to `settings.grimReaper`, from
 * the same `lost` array `hardModeDeathLoss` returns. Returns null for a death
 * that took nothing (an empty pack) — callers should leave any existing
 * stash alone rather than overwrite it with nothing.
 *
 * `source` names what killed the player (`{ id, name }` — a boss or raid id),
 * shown on the Grim Reaper screen and the death modal. Optional.
 */
export function grimReaperStashFromDeath(itemsLost, source, diedAt = Date.now()) {
  if (!Array.isArray(itemsLost) || itemsLost.length === 0) return null
  const items = itemsLost
    .map((entry) => {
      const itemId = entry?.itemId
      if (typeof itemId !== 'string' || !itemId) return null
      const quantity = Math.max(0, Math.floor(Number(entry.quantity) || 0))
      if (quantity <= 0) return null
      const charges = Math.max(0, Math.floor(Number(entry.charges) || 0))
      return charges > 0 ? { itemId, quantity, charges } : { itemId, quantity }
    })
    .filter(Boolean)
  if (items.length === 0) return null
  return {
    diedAt: Number.isFinite(Number(diedAt)) ? Number(diedAt) : Date.now(),
    source: source?.id != null ? { id: source.id, name: source.name || null } : null,
    items,
  }
}
