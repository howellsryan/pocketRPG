import { getPvpCoinReplacementValue, isPvpCoinReplacementItem, isPvpTradeable } from './lootTransfer.js'

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

export function getItemShopValue(itemStack, itemsData) {
  const itemId = itemStack?.itemId
  if (!itemId || !itemsData) return 0
  if (isPvpCoinReplacementItem(itemId, itemsData)) return getPvpCoinReplacementValue(itemStack, itemsData)
  if (!isPvpTradeable(itemId, itemsData)) return 0
  if (itemId === 'coins') return quantityOf(itemStack)
  const item = itemsData[itemId]
  const shopValue = Number(item?.shopValue)
  if (!Number.isFinite(shopValue) || shopValue <= 0) return 0
  return Math.floor(shopValue) * quantityOf(itemStack)
}

export function calculatePvpRiskValues({ inventory, equipment, itemsData }) {
  const invStacks = toStacks(inventory)
  const eqStacks = toStacks(equipment)
  const inventoryShopValue = invStacks.reduce((sum, stack) => sum + getItemShopValue(stack, itemsData), 0)
  const equipmentShopValue = eqStacks.reduce((sum, stack) => sum + getItemShopValue(stack, itemsData), 0)
  return { inventoryShopValue, equipmentShopValue, totalShopValue: inventoryShopValue + equipmentShopValue }
}
