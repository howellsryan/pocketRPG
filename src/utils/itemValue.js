export const EPIC_LOOT_THRESHOLD = 1_000_000

// Fraction of an item's shopValue an Ironman receives when no explicit
// `ironmanShopValue` is authored on the item. Deliberately well below 1 so
// Ironmen — who can liquidate order-book items only through this path — can't
// turn loot into gp at the full market/shop rate. Tune per-item by adding an
// explicit `ironmanShopValue` to src/data/items.json.
export const IRONMAN_VALUE_FRACTION = 0.4

// Hard ceiling on what an Ironman can realise from one item by selling or
// alching it. No single Ironman sell/alch ever pays (or displays) more than
// this, regardless of the item's shop/ironman value — so a billion-gp unique
// liquidates for 1m, not a fortune. Normal accounts are not capped.
export const IRONMAN_VALUE_CAP = 1_000_000

// The gp an Ironman gets for one of this item when vendoring it (the
// sell-immediate path). An explicit `ironmanShopValue` on the item wins;
// otherwise fall back to IRONMAN_VALUE_FRACTION × shopValue. The result is
// clamped to IRONMAN_VALUE_CAP. Items with no shop value (and no explicit
// override) return 0 — nothing to sell against.
// NOTE: a server-side copy lives in functions/_lib/game/itemValue.js — keep
// the two aligned.
export function getIronmanShopValue(item) {
  if (!item) return 0
  let raw
  const explicit = Number(item.ironmanShopValue)
  if (Number.isFinite(explicit) && explicit >= 0) {
    raw = Math.floor(explicit)
  } else {
    const shop = Number(item.shopValue)
    raw = (Number.isFinite(shop) && shop > 0) ? Math.floor(shop * IRONMAN_VALUE_FRACTION) : 0
  }
  return Math.min(raw, IRONMAN_VALUE_CAP)
}

// High-alchemy payout for one item. Normal accounts alch at shopValue × 1.1;
// Ironmen alch at their (reduced) ironmanShopValue × 1.1, then clamped to
// IRONMAN_VALUE_CAP so the spell can't bypass either the Ironman value curve
// or the 1m ceiling. Single source of truth for the ×1.1 across the live magic
// screen, live skilling screen and the idle engine.
export function getHighAlchValue(item, { isIronman = false } = {}) {
  if (!item) return 0
  if (isIronman) {
    return Math.min(Math.floor(getIronmanShopValue(item) * 1.1), IRONMAN_VALUE_CAP)
  }
  return Math.floor((Number(item.shopValue) || 0) * 1.1)
}

export function getItemUnitValue(itemId, itemsData) {
  if (!itemId || !itemsData) return null
  if (itemId === 'coins') return 1
  const raw = itemsData[itemId]?.shopValue
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

// True when a single item is itself legendary — its own unit value reaches the
// epic threshold. Quantity is irrelevant: one legendary item qualifies no matter
// the count, and any number of cheap items never does.
export function isLegendaryItem(itemId, itemsData) {
  const unitValue = getItemUnitValue(itemId, itemsData)
  return !!unitValue && unitValue >= EPIC_LOOT_THRESHOLD
}

// Total shop value of a loot collection. Accepts either an array of
// { itemId, quantity } entries or an { itemId: quantity } map.
export function getLootTotalValue(loot, itemsData) {
  if (!loot) return 0
  const entries = Array.isArray(loot)
    ? loot.filter(Boolean).map((e) => [e.itemId, e.quantity])
    : Object.entries(loot)
  let total = 0
  for (const [itemId, quantity] of entries) {
    const unitValue = getItemUnitValue(itemId, itemsData)
    if (!unitValue) continue
    total += unitValue * Math.max(0, Number(quantity) || 0)
  }
  return total
}

// Drops worth over 1m get the purple/epic fireworks treatment.
export function isEpicLootValue(totalValue) {
  return Number(totalValue) > EPIC_LOOT_THRESHOLD
}

// True when the loot contains at least one legendary item. The purple
// treatment keys off this — NOT the summed total, and NOT a large stack of
// cheap items — so the screen only goes purple when a genuinely legendary item
// is received. Accepts either an array of { itemId, quantity } entries or an
// { itemId: quantity } map.
export function hasEpicLootDrop(loot, itemsData) {
  if (!loot) return false
  const entries = Array.isArray(loot)
    ? loot.filter(Boolean).map((e) => [e.itemId, e.quantity])
    : Object.entries(loot)
  for (const [itemId] of entries) {
    if (isLegendaryItem(itemId, itemsData)) return true
  }
  return false
}
