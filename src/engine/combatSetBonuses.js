// Data-driven combat set bonuses. Each entry lists the itemId aliases accepted
// per equipment slot and the combat multipliers granted when the full set is
// worn. Bonuses from multiple active sets combine: multiplicative fields
// multiply together, magicDamageBonusFlat values add. Adding a new set =
// append one entry here; no engine changes required.
//
// Legacy `void_knight_*` itemIds are accepted so saves that have not yet been
// migrated still receive the Void bonus during their first load (see
// src/engine/itemMigrations.js).

const COMBAT_SETS = [
  {
    id: 'void_king',
    slots: {
      head: ['void_king_helm', 'void_knight_helm'],
      body: ['void_king_top', 'void_knight_top'],
      legs: ['void_king_robe', 'void_knight_robe'],
      gloves: ['void_king_gloves', 'void_knight_gloves'],
    },
    multipliers: {
      meleeAccuracy: 1.125,
      meleeDamage: 1.125,
      rangedAccuracy: 1.125,
      rangedDamage: 1.125,
      magicAccuracy: 1.45,
    },
    magicDamageBonusFlat: 10,
  },
  {
    id: 'masari',
    slots: {
      head: ['masari_mask'],
      body: ['masari_body'],
      legs: ['masari_chaps'],
    },
    multipliers: {
      rangedAccuracy: 1.1,
      rangedDamage: 1.1,
    },
    magicDamageBonusFlat: 0,
  },
]

const MULTIPLIER_KEYS = [
  'meleeAccuracy',
  'meleeDamage',
  'rangedAccuracy',
  'rangedDamage',
  'magicAccuracy',
]

function identityMultipliers() {
  return {
    meleeAccuracy: 1,
    meleeDamage: 1,
    rangedAccuracy: 1,
    rangedDamage: 1,
    magicAccuracy: 1,
    magicDamageBonusFlat: 0,
  }
}

function equippedItemId(equipment, slot) {
  const entry = equipment?.[slot]
  return entry?.itemId || null
}

function hasFullSet(equipment, set) {
  for (const [slot, aliases] of Object.entries(set.slots)) {
    if (!aliases.includes(equippedItemId(equipment, slot))) return false
  }
  return true
}

function applySet(out, set) {
  const m = set.multipliers || {}
  for (const key of MULTIPLIER_KEYS) {
    if (m[key]) out[key] *= m[key]
  }
  out.magicDamageBonusFlat += set.magicDamageBonusFlat || 0
  return out
}

/**
 * Combined combat multipliers from every full set the player is wearing.
 * This is the value combat engines should consume.
 */
export function getCombatSetMultipliers(equipment) {
  const out = identityMultipliers()
  for (const set of COMBAT_SETS) {
    if (hasFullSet(equipment, set)) applySet(out, set)
  }
  return out
}

const VOID_SET = COMBAT_SETS.find(s => s.id === 'void_king')

export function hasFullVoidKingSet(equipment) {
  return hasFullSet(equipment, VOID_SET)
}

/**
 * Void-only multipliers. Retained for backwards compatibility; prefer
 * getCombatSetMultipliers, which folds in every active set.
 */
export function getVoidKingCombatMultipliers(equipment) {
  const out = identityMultipliers()
  if (hasFullSet(equipment, VOID_SET)) applySet(out, VOID_SET)
  return out
}

const VOID_SET_ITEM_IDS = VOID_SET.slots
  ? [VOID_SET.slots.body[0], VOID_SET.slots.legs[0], VOID_SET.slots.head[0], VOID_SET.slots.gloves[0]]
  : []

export { VOID_SET_ITEM_IDS, COMBAT_SETS }
