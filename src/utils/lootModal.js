import { getItemUnitValue } from './itemValue.js'

// Only a raid completion earns the full-screen loot modal — a whole run's
// worth of loot is a genuine takeover moment. A standalone boss now announces
// itself the same way an ordinary monster does: a reward-reveal card, so the
// fight carries on instead of stopping dead on a modal every kill.
export function killPresentsFullModal({ raidId } = {}) {
  return !!raidId
}

/**
 * Kill drops as reward-reveal entries: one chip per item id, so a drop table
 * that rolled the same item twice reads as a single stack rather than two
 * chips fighting over the same render key.
 */
export function killRevealRewards(drops) {
  const byId = new Map()
  for (const drop of (drops || [])) {
    const itemId = drop?.itemId
    const quantity = Math.floor(Number(drop?.quantity ?? 1) || 0)
    if (!itemId || quantity < 1) continue
    byId.set(itemId, (byId.get(itemId) || 0) + quantity)
  }
  return [...byId].map(([itemId, quantity]) => ({ itemId, quantity }))
}

// Shared shaping for the post-kill loot modal, so a solo kill and a co-op kill
// present the same way.
//
// The spotlight is the highest *unit* shop value — the rare/prestige drop — not
// the biggest stack, or a million coins would outrank dragon claws. Ties break
// on total value. The remaining list keeps total-value ordering.
export function shapeLootForModal(drops, itemsData) {
  const valued = (drops || []).map((d) => {
    const unitGp = getItemUnitValue(d.itemId, itemsData) || 0
    return { ...d, unitGp, totalGp: unitGp * (d.quantity || 1) }
  })
  const hero = valued.reduce((best, d) => {
    if (!best) return d
    if ((d.unitGp || 0) !== (best.unitGp || 0)) return (d.unitGp || 0) > (best.unitGp || 0) ? d : best
    return (d.totalGp || 0) > (best.totalGp || 0) ? d : best
  }, null)
  const rest = [...valued].sort((a, b) => b.totalGp - a.totalGp).filter((d) => d !== hero)
  return {
    valued,
    hero,
    heroItem: hero ? (itemsData[hero.itemId] || null) : null,
    rest,
    total: valued.reduce((sum, d) => sum + d.totalGp, 0),
  }
}

/** The `loot` rows <LootResultModal> expects, for everything but the hero. */
export function lootRowsForModal(rest, itemsData) {
  return (rest || []).map((drop, idx) => ({
    key: idx,
    item: itemsData[drop.itemId] || null,
    name: itemsData[drop.itemId]?.name || drop.itemId,
    quantity: drop.quantity,
    gp: drop.totalGp,
    unitGp: drop.unitGp,
  }))
}
