// Void King set: 4-piece bonus granted when the canonical helm/top/robe/gloves
// are equipped together. Legacy `void_knight_*` itemIds are accepted so saves
// that have not yet been migrated still receive the bonus during their first
// load (see src/engine/itemMigrations.js).

const VOID_SET_ITEM_IDS = ['void_king_top', 'void_king_robe', 'void_king_helm', 'void_king_gloves']

const VOID_KING_ALIASES = {
  head: ['void_king_helm', 'void_knight_helm'],
  body: ['void_king_top', 'void_knight_top'],
  legs: ['void_king_robe', 'void_knight_robe'],
  gloves: ['void_king_gloves', 'void_knight_gloves'],
}

function equippedItemId(equipment, slot) {
  const entry = equipment?.[slot]
  return entry?.itemId || null
}

export function hasFullVoidKingSet(equipment) {
  for (const [slot, aliases] of Object.entries(VOID_KING_ALIASES)) {
    if (!aliases.includes(equippedItemId(equipment, slot))) return false
  }
  return true
}

export function getVoidKingCombatMultipliers(equipment) {
  if (!hasFullVoidKingSet(equipment)) {
    return {
      meleeAccuracy: 1,
      meleeDamage: 1,
      rangedAccuracy: 1,
      rangedDamage: 1,
      magicAccuracy: 1,
      magicDamageBonusFlat: 0,
    }
  }
  return {
    meleeAccuracy: 1.125,
    meleeDamage: 1.125,
    rangedAccuracy: 1.125,
    rangedDamage: 1.125,
    magicAccuracy: 1.45,
    magicDamageBonusFlat: 10,
  }
}

export { VOID_SET_ITEM_IDS }
