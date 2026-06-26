// Server-side copy of the Ironman vendor-value resolver. Keep aligned with
// src/utils/itemValue.js (the client computes the same value for the sell UI;
// the server is authoritative for the sell-immediate payout).

export const IRONMAN_VALUE_FRACTION = 0.4

// Hard ceiling on an Ironman's per-item sell/alch realisation. Normal accounts
// are not capped. Mirrors IRONMAN_VALUE_CAP in src/utils/itemValue.js.
export const IRONMAN_VALUE_CAP = 1_000_000

// The gp an Ironman gets for one of this item when vendoring it. An explicit
// `ironmanShopValue` on the item wins; otherwise fall back to
// IRONMAN_VALUE_FRACTION × shopValue. Clamped to IRONMAN_VALUE_CAP. Items with
// no shop value (and no explicit override) return 0.
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
// Ironmen alch at their (reduced) ironmanShopValue × 1.1, clamped to
// IRONMAN_VALUE_CAP. Mirrors getHighAlchValue in src/utils/itemValue.js.
export function getHighAlchValue(item, { isIronman = false } = {}) {
  if (!item) return 0
  if (isIronman) {
    return Math.min(Math.floor(getIronmanShopValue(item) * 1.1), IRONMAN_VALUE_CAP)
  }
  return Math.floor((Number(item.shopValue) || 0) * 1.1)
}
