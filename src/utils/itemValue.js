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
  return (unitValue * qty) > 1_000_000
}
