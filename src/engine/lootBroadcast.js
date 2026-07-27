import { isLegendaryItem } from '../utils/itemValue.js'

// What a multiplayer instance announces to everyone when one player gets a big
// drop. The predicate is deliberately the same one that turns the loot modal
// purple (isLegendaryItem — a single item worth EPIC_LOOT_THRESHOLD or more), so
// the room is told about exactly what the winner sees celebrated, and a
// thousand-coin stack never trips it.
//
// Deduped by item id: one announcement per item, however many rolled.
export function epicDropsFrom(loot, itemsData) {
  const seen = new Set()
  const out = []
  for (const entry of loot || []) {
    const itemId = entry?.itemId
    if (!itemId || seen.has(itemId)) continue
    seen.add(itemId)
    if (isLegendaryItem(itemId, itemsData)) out.push(itemId)
  }
  return out
}

/**
 * The co-op room's per-kill announcements, one per legendary item per winner.
 *
 * Carries the item and the winner only. The rest of that winner's drops stay
 * private (coopProjection strips them per poll for a reason) — this is the one
 * part of a kill everybody is meant to see.
 *
 * A settlement that failed announces nothing: nobody received anything yet.
 */
export function coopEpicDropEvents({ shares, members, bossName, tick, itemsData }) {
  const out = []
  for (const share of shares || []) {
    if (!share || share.failed) continue
    const member = members?.[String(share.characterId)]
    for (const itemId of epicDropsFrom(share.granted, itemsData)) {
      out.push({
        type: 'epicDrop',
        tick,
        characterId: share.characterId,
        username: member?.username || 'Someone',
        item: itemsData?.[itemId]?.name || itemId,
        monster: bossName,
      })
    }
  }
  return out
}
