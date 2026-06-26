// Server-side copy of the Ironman vendor-value resolver. Keep aligned with
// src/utils/itemValue.js (the client computes the same value for the sell UI;
// the server is authoritative for the sell-immediate payout).

export const IRONMAN_VALUE_FRACTION = 0.4

// The gp an Ironman gets for one of this item when vendoring it. An explicit
// `ironmanShopValue` on the item wins; otherwise fall back to
// IRONMAN_VALUE_FRACTION × shopValue. Items with no shop value (and no explicit
// override) return 0.
export function getIronmanShopValue(item) {
  if (!item) return 0
  const explicit = Number(item.ironmanShopValue)
  if (Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit)
  const shop = Number(item.shopValue)
  if (!Number.isFinite(shop) || shop <= 0) return 0
  return Math.floor(shop * IRONMAN_VALUE_FRACTION)
}

// High-alchemy payout for one item. Normal accounts alch at shopValue × 1.1;
// Ironmen alch at their (reduced) ironmanShopValue × 1.1. Mirrors
// getHighAlchValue in src/utils/itemValue.js.
export function getHighAlchValue(item, { isIronman = false } = {}) {
  if (!item) return 0
  const base = isIronman
    ? getIronmanShopValue(item)
    : Math.floor(Number(item.shopValue) || 0)
  return Math.floor(base * 1.1)
}
