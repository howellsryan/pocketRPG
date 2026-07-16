// Special-attack energy cost helpers. Flat-cost weapons (`energyCost`) keep
// their existing fixed-cost behavior; percent-cost weapons (`energyCostPercent`,
// e.g. Zul-Kaar's Blade's Disrupt) instead spend a share of whatever energy is
// currently banked, floored to at least 1 and capped at the energy on hand so a
// percent special can never overdraw. Pure — no UI import; energy values flow
// in as plain numbers from combatState.specialAttackEnergy (§6/§7 PocketRPG
// PvE special energy: 0-100, starts each fight at 100, drains on use).
export function resolveSpecialEnergyCost(specialAttack, currentEnergy) {
  const energy = Math.max(0, Number(currentEnergy) || 0)
  if (specialAttack?.energyCostPercent > 0) {
    return Math.min(energy, Math.max(1, Math.ceil(energy * specialAttack.energyCostPercent / 100)))
  }
  return Math.max(0, Number(specialAttack?.energyCost) || 0)
}

export function canAffordSpecialAttack(specialAttack, currentEnergy) {
  const energy = Math.max(0, Number(currentEnergy) || 0)
  if (specialAttack?.energyCostPercent > 0) return energy > 0
  return energy >= (Number(specialAttack?.energyCost) || 0)
}

export function formatSpecialEnergyCostLabel(specialAttack) {
  if (specialAttack?.energyCostPercent > 0) return `${specialAttack.energyCostPercent}% of current energy`
  return `${Number(specialAttack?.energyCost) || 0}% cost`
}
