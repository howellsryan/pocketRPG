const VOID_SET_ITEM_IDS = ['void_knight_top', 'void_knight_robe', 'void_knight_helm', 'void_knight_gloves']

function equippedItemId(equipment, slot) {
  const entry = equipment?.[slot]
  return entry?.itemId || null
}

export function hasFullVoidKnightSet(equipment) {
  return equippedItemId(equipment, 'body') === 'void_knight_top'
    && equippedItemId(equipment, 'legs') === 'void_knight_robe'
    && equippedItemId(equipment, 'head') === 'void_knight_helm'
    && equippedItemId(equipment, 'hands') === 'void_knight_gloves'
}

export function getVoidKnightCombatMultipliers(equipment) {
  if (!hasFullVoidKnightSet(equipment)) {
    return { meleeAccuracy: 1, meleeDamage: 1, rangedAccuracy: 1, rangedDamage: 1, magicAccuracy: 1, magicDamage: 1 }
  }
  return { meleeAccuracy: 1.125, meleeDamage: 1.125, rangedAccuracy: 1.125, rangedDamage: 1.125, magicAccuracy: 1.45, magicDamage: 1.05 }
}

export { VOID_SET_ITEM_IDS }
