function toStacks(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  return Object.values(value)
}

function quantityOf(stack) {
  const qty = Number(stack?.quantity)
  if (!Number.isFinite(qty) || qty <= 0) return 1
  return Math.floor(qty)
}

function isLootableTradeable(item, itemId) {
  if (!item || typeof item !== 'object') return false
  if (itemId === 'coins') return true
  return !!item.tradeable
}

export function getItemShopValue(itemStack, itemsData) {
  const itemId = itemStack?.itemId
  if (!itemId || !itemsData) return 0
  const item = itemsData[itemId]
  if (!isLootableTradeable(item, itemId)) return 0
  const shopValue = Number(item.shopValue)
  if (!Number.isFinite(shopValue) || shopValue <= 0) return 0
  return Math.floor(shopValue) * quantityOf(itemStack)
}

export function calculatePvpRiskValues({ inventory, equipment, itemsData }) {
  const invStacks = toStacks(inventory)
  const eqStacks = toStacks(equipment)

  const inventoryShopValue = invStacks.reduce((sum, stack) => sum + getItemShopValue(stack, itemsData), 0)
  const equipmentShopValue = eqStacks.reduce((sum, stack) => sum + getItemShopValue(stack, itemsData), 0)
  return {
    inventoryShopValue,
    equipmentShopValue,
    totalShopValue: inventoryShopValue + equipmentShopValue,
  }
}
