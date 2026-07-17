// Data-driven combat set bonuses. Each entry lists the itemId aliases accepted
// per equipment slot and the combat multipliers granted when the full set is
// worn. An entry may also set `requiredWeapons` (itemIds) — when present, the
// set only activates if the equipped weapon is one of them, in addition to
// the armour slots. Bonuses from multiple active sets combine: multiplicative
// fields multiply together, magicDamageBonusFlat/accuracyFlat values add
// (accuracyFlat is a flat bonus added to the attack-roll bonus before the
// per-style multiplier, applied uniformly to melee/ranged/magic). Adding a
// new set = append one entry here; no engine changes required unless it
// needs a new bonus shape.
//
// Legacy `void_knight_*` itemIds are accepted so saves that have not yet been
// migrated still receive the Void bonus during their first load (see
// src/engine/itemMigrations.js).

const COMBAT_SETS = [
  {
    id: 'void_king',
    name: 'Void King',
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
    name: 'Masari',
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
  {
    // Armour-only set (no gloves slot). Requires one of the matching
    // Shardglass weapons equipped too — a pure-armour full set grants nothing.
    id: 'shardglass',
    name: 'Shardglass',
    slots: {
      head: ['shardglass_helmet'],
      body: ['shardglass_plate_body'],
      legs: ['shardglass_platelegs'],
    },
    requiredWeapons: ['blade_of_saeldor', 'bow_of_faerdhinen'],
    accuracyFlat: 30,
  },
]

const MULTIPLIER_KEYS = [
  'meleeAccuracy',
  'meleeDamage',
  'rangedAccuracy',
  'rangedDamage',
  'magicAccuracy',
]

const MULTIPLIER_LABELS = {
  meleeAccuracy: 'Melee Accuracy',
  meleeDamage: 'Melee Damage',
  rangedAccuracy: 'Ranged Accuracy',
  rangedDamage: 'Ranged Damage',
  magicAccuracy: 'Magic Accuracy',
}

function identityMultipliers() {
  return {
    meleeAccuracy: 1,
    meleeDamage: 1,
    rangedAccuracy: 1,
    rangedDamage: 1,
    magicAccuracy: 1,
    magicDamageBonusFlat: 0,
    accuracyFlat: 0,
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
  if (set.requiredWeapons && !set.requiredWeapons.includes(equippedItemId(equipment, 'weapon'))) return false
  return true
}

function applySet(out, set) {
  const m = set.multipliers || {}
  for (const key of MULTIPLIER_KEYS) {
    if (m[key]) out[key] *= m[key]
  }
  out.magicDamageBonusFlat += set.magicDamageBonusFlat || 0
  out.accuracyFlat += set.accuracyFlat || 0
  return out
}

/**
 * UI-friendly bonus lines for one set: percentage lines for multipliers and
 * magicDamageBonusFlat (which is itself a percentage-point value, matching
 * otherBonus.magicDamage), and flat (non-percent) lines for accuracyFlat
 * since that's added to the raw attack-bonus stat, not a percentage.
 */
function describeSetBonuses(set) {
  const lines = []
  const m = set.multipliers || {}
  for (const key of MULTIPLIER_KEYS) {
    if (m[key]) lines.push({ label: MULTIPLIER_LABELS[key], value: Math.round((m[key] - 1) * 1000) / 10, percent: true })
  }
  if (set.magicDamageBonusFlat) lines.push({ label: 'Magic Damage', value: set.magicDamageBonusFlat, percent: true })
  if (set.accuracyFlat) {
    lines.push({ label: 'Melee Accuracy', value: set.accuracyFlat, percent: false })
    lines.push({ label: 'Ranged Accuracy', value: set.accuracyFlat, percent: false })
    lines.push({ label: 'Magic Accuracy', value: set.accuracyFlat, percent: false })
  }
  return lines
}

/**
 * Every combat set currently active for this equipment, as UI-ready
 * { id, name, lines } entries. Drives the Equipment screen's set-bonus
 * panel — add a set to COMBAT_SETS and it shows up here for free.
 */
export function getActiveSetBonusDisplays(equipment) {
  return COMBAT_SETS
    .filter(set => hasFullSet(equipment, set))
    .map(set => ({ id: set.id, name: set.name || set.id, lines: describeSetBonuses(set) }))
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

const SHARDGLASS_SET = COMBAT_SETS.find(s => s.id === 'shardglass')

export function hasFullShardglassSet(equipment) {
  return hasFullSet(equipment, SHARDGLASS_SET)
}

const VOID_SET_ITEM_IDS = VOID_SET.slots
  ? [VOID_SET.slots.body[0], VOID_SET.slots.legs[0], VOID_SET.slots.head[0], VOID_SET.slots.gloves[0]]
  : []

export { VOID_SET_ITEM_IDS, COMBAT_SETS }
