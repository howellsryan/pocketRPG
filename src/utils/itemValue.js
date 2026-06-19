export const EPIC_LOOT_THRESHOLD = 1_000_000

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
