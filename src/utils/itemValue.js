export const EPIC_LOOT_THRESHOLD = 1_000_000

export function getItemUnitValue(itemId, itemsData) {
  if (!itemId || !itemsData) return null
  if (itemId === 'coins') return 1
  const raw = itemsData[itemId]?.shopValue
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

export function isHighValueDrop(itemId, quantity, itemsData) {
  const unitValue = getItemUnitValue(itemId, itemsData)
  if (!unitValue) return false
  const qty = Math.max(0, Number(quantity) || 0)
  return (unitValue * qty) > EPIC_LOOT_THRESHOLD
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

// True when at least one individual item stack in the loot is itself worth over
// the epic threshold. The purple treatment keys off this — NOT the summed total
// — so a pile of cheap drops never turns the screen purple. Accepts either an
// array of { itemId, quantity } entries or an { itemId: quantity } map.
export function hasEpicLootDrop(loot, itemsData) {
  if (!loot) return false
  const entries = Array.isArray(loot)
    ? loot.filter(Boolean).map((e) => [e.itemId, e.quantity])
    : Object.entries(loot)
  for (const [itemId, quantity] of entries) {
    if (isHighValueDrop(itemId, quantity, itemsData)) return true
  }
  return false
}
