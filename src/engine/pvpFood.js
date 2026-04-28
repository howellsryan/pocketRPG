export function getPvpHealAmount(item) {
  const healAmount = Number(item?.heals ?? item?.heal ?? 0)
  if (!Number.isFinite(healAmount)) return 0
  return Math.max(0, Math.floor(healAmount))
}

export function isPvpFoodItem(item) {
  return getPvpHealAmount(item) > 0
}
