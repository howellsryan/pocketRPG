import { EQUIPMENT_SLOTS } from '../utils/constants.js'
import { getLevelFromXP } from './experience.js'

/**
 * Validate that the player meets an item's equip requirements.
 * Returns null if OK, or a { reason, ... } descriptor so callers can show a
 * precise toast. Keeping this in the engine makes every equip path (inventory
 * screen, combat screen gear tab, any future UI) share the same gate — no
 * screen can forget to check and let the player equip gear they haven't
 * earned.
 *
 *   reason === 'quest' → { reason, questUnlock }
 *   reason === 'skill' → { reason, skill, required, current }
 */
export function checkEquipRequirements(itemData, stats, completedQuests) {
  if (itemData?.questUnlock && !(completedQuests && completedQuests.has && completedQuests.has(itemData.questUnlock))) {
    return { reason: 'quest', questUnlock: itemData.questUnlock }
  }
  if (itemData?.requirements) {
    for (const [skill, level] of Object.entries(itemData.requirements)) {
      const playerLevel = stats && stats[skill] ? getLevelFromXP(stats[skill].xp) : 1
      if (playerLevel < level) {
        return { reason: 'skill', skill, required: level, current: playerLevel }
      }
    }
  }
  return null
}

/**
 * Create empty equipment set
 */
export function createEquipment() {
  const eq = {}
  for (const slot of EQUIPMENT_SLOTS) {
    eq[slot] = null // null = empty, or { itemId }
  }
  return eq
}

/**
 * Check if an ammo item is compatible with the currently equipped weapon.
 * Returns true if compatible, false if not.
 * Also returns true if no weapon is equipped or if either item has no ammoType/ammoKind.
 */
export function isAmmoCompatible(equipment, ammoItemData, itemsData) {
  if (!equipment.weapon) return true
  const weapon = itemsData[equipment.weapon.itemId]
  if (!weapon) return true
  const ammoKind = ammoItemData?.ammoKind
  const requiredAmmoKind = weapon.ammoType
  const requiredAmmoIds = normaliseRequiredAmmoIds(weapon)
  if (!requiredAmmoKind && requiredAmmoIds.length === 0) return true
  if (!ammoKind) return false
  if (requiredAmmoKind && ammoKind !== requiredAmmoKind) return false
  if (requiredAmmoIds.length > 0 && !requiredAmmoIds.includes(ammoItemData.id)) return false
  return true
}

function getEquippedAmmoQuantity(ammoEntry) {
  if (!ammoEntry) return 0
  const quantity = Number(ammoEntry.quantity)
  if (!Number.isFinite(quantity)) return 1
  return quantity
}

function normaliseRequiredAmmoIds(weapon) {
  if (!weapon) return []
  if (Array.isArray(weapon.requiredAmmoIds)) return weapon.requiredAmmoIds
  if (weapon.requiredAmmoId) return [weapon.requiredAmmoId]
  return []
}

export function getRangedAmmoRequirementFailure(equipment, itemsData) {
  const weaponEntry = equipment?.weapon
  const weapon = weaponEntry?.itemId ? itemsData?.[weaponEntry.itemId] : null
  if (!weapon || weapon.attackStyle !== 'ranged') return null
  if (weapon.scaleCharged) return null
  const requiredAmmoKind = weapon.ammoType
  if (!requiredAmmoKind) return null
  const ammoEntry = equipment?.ammo
  const ammo = ammoEntry?.itemId ? itemsData?.[ammoEntry.itemId] : null
  const ammoQuantity = getEquippedAmmoQuantity(ammoEntry)
  const requiredAmmoIds = normaliseRequiredAmmoIds(weapon)
  const failureBase = {
    weaponId: weapon.id,
    weaponName: weapon.name || weapon.id,
    requiredAmmoKind,
    requiredAmmoIds,
    requiredAmmoName: requiredAmmoIds.length === 1 ? (itemsData?.[requiredAmmoIds[0]]?.name || requiredAmmoIds[0]) : null
  }
  if (!ammoEntry || !ammo || ammoQuantity <= 0) return { ...failureBase, reason: 'missing_ammo' }
  if (ammo.ammoKind !== requiredAmmoKind) return { ...failureBase, actualAmmoId: ammo.id, actualAmmoKind: ammo.ammoKind || null, reason: 'wrong_ammo_type' }
  if (requiredAmmoIds.length > 0 && !requiredAmmoIds.includes(ammo.id)) return { ...failureBase, actualAmmoId: ammo.id, actualAmmoKind: ammo.ammoKind || null, reason: 'wrong_ammo_item' }
  return null
}

/**
 * Equip an item. Returns { equipped: true, unequipped: [] } or { equipped: false, reason }
 * Handles 2H weapon / shield conflicts and ammo-weapon type validation.
 *
 * The optional `sourceSlot` argument is the inventory slot being equipped from;
 * its `charges` (if any) carry over to the equipment entry so that scale-charged
 * weapons don't lose their charges when re-equipped.
 * For ammo, `sourceSlot.quantity` is preserved so ammo quantity is maintained.
 */
export function equipItem(equipment, itemData, itemsData, sourceSlot) {
  const slot = itemData.slot
  if (!slot || !EQUIPMENT_SLOTS.includes(slot)) return { equipped: false, unequipped: [] }

  const unequipped = []

  // Validate ammo type vs equipped weapon
  if (slot === 'ammo' && itemsData) {
    if (!isAmmoCompatible(equipment, itemData, itemsData)) {
      return { equipped: false, unequipped: [], reason: 'wrong_ammo_type' }
    }
  }

  // 2H weapon clears shield
  if (slot === 'weapon' && itemData.twoHanded) {
    if (equipment.shield) {
      unequipped.push(equipment.shield)
      equipment.shield = null
    }
  }

  // Shield clears 2H weapon (need to check current weapon)
  if (slot === 'shield' && equipment.weapon) {
    // The caller must pass the current weapon's itemData to check twoHanded
    // For now we store a flag on the equipment entry
    if (equipment.weapon._twoHanded) {
      unequipped.push(equipment.weapon)
      equipment.weapon = null
    }
  }

  // Unequip current item in this slot
  if (equipment[slot]) {
    unequipped.push(equipment[slot])
  }

  const entry = {
    itemId: itemData.id,
    _twoHanded: itemData.twoHanded || false
  }
  // Preserve charges from the inventory slot for scale-charged weapons
  if (sourceSlot && sourceSlot.charges && sourceSlot.charges > 0) {
    entry.charges = sourceSlot.charges
  }
  // Preserve quantity for ammo
  if (slot === 'ammo' && sourceSlot && sourceSlot.quantity) {
    entry.quantity = sourceSlot.quantity
  }
  equipment[slot] = entry

  return { equipped: true, unequipped }
}

/**
 * Place items displaced by equipItem() back into inventory (merging into an
 * existing stack when stackable, else into an empty slot). Equipping a 2H
 * weapon can displace both the old weapon AND a shield — two items freed by
 * only one inventory slot (the one the newly-equipped item came from) — so
 * placement can fail even though the immediate slot was freed. Returns
 * `{ ok: false }` without mutating `inventory` if any item has nowhere to
 * go, so the caller can abort the whole equip rather than silently
 * dropping the item that didn't fit.
 */
export function placeUnequippedItems(unequipped, inventory, itemsData) {
  const newInv = [...inventory]
  for (const item of unequipped) {
    if (!item) continue
    const itemData = itemsData?.[item.itemId]
    if (itemData?.stackable) {
      const existingIdx = newInv.findIndex(s => s && s.itemId === item.itemId)
      if (existingIdx !== -1) {
        newInv[existingIdx] = { ...newInv[existingIdx], quantity: (newInv[existingIdx].quantity || 1) + (item.quantity || 1) }
        continue
      }
    }
    const emptyIdx = newInv.indexOf(null)
    if (emptyIdx === -1) return { ok: false, inventory }
    const invEntry = { itemId: item.itemId, quantity: item.quantity || 1 }
    if (item.charges && item.charges > 0) invEntry.charges = item.charges
    newInv[emptyIdx] = invEntry
  }
  return { ok: true, inventory: newInv }
}

/**
 * Unequip a slot. Returns the item that was removed (or null).
 */
export function unequipSlot(equipment, slot) {
  const item = equipment[slot]
  equipment[slot] = null
  return item
}

/**
 * Aggregate equipment bonuses from all slots.
 * itemsData is the items.json lookup object.
 */
export function getEquipmentBonuses(equipment, itemsData) {
  const bonuses = {
    attackBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 0, rangedStrength: 0, magicDamage: 0 }
  }

  for (const slot of EQUIPMENT_SLOTS) {
    if (!equipment[slot]) continue
    const item = itemsData[equipment[slot].itemId]
    if (!item) continue

    if (item.attackBonus) {
      for (const [k, v] of Object.entries(item.attackBonus)) {
        bonuses.attackBonus[k] = (bonuses.attackBonus[k] || 0) + v
      }
    }
    if (item.defenceBonus) {
      for (const [k, v] of Object.entries(item.defenceBonus)) {
        bonuses.defenceBonus[k] = (bonuses.defenceBonus[k] || 0) + v
      }
    }
    if (item.otherBonus) {
      for (const [k, v] of Object.entries(item.otherBonus)) {
        // Ammo rangedStrength only applies when the equipped weapon uses that ammo type
        if (slot === 'ammo' && k === 'rangedStrength') {
          const weapon = equipment.weapon ? itemsData[equipment.weapon.itemId] : null
          if (!weapon?.ammoType || weapon.ammoType !== item.ammoKind) continue
        }
        bonuses.otherBonus[k] = (bonuses.otherBonus[k] || 0) + v
      }
    }
  }

  return bonuses
}

/**
 * Multiplier a magic weapon applies to the magic-damage bonus of the rest of
 * the worn gear (e.g. Shadow of Tumaken triples it). Data-driven via the
 * weapon's `magicDamageMultiplier` field so any future staff can opt in;
 * returns 1 when no weapon is equipped or the weapon has no multiplier.
 * Shared by the live (combat.js), idle (idleEngine.js) and PvP
 * (combatPrimitives.js) magic paths.
 */
export function getWeaponMagicDamageMultiplier(equipment, itemsData) {
  const weaponEntry = equipment?.weapon
  const weapon = weaponEntry ? itemsData?.[weaponEntry.itemId] : null
  const mult = Number(weapon?.magicDamageMultiplier)
  return Number.isFinite(mult) && mult > 0 ? mult : 1
}

/**
 * Worn magic-damage bonus after the equipped weapon's multiplier, with the
 * multiplied passive capped at the weapon's `magicDamageMultiplierCap`. This
 * mirrors OSRS's Tumeken's shadow: it triples the worn gear's magic damage but
 * the tripled bonus can never exceed +100% total. The cap only applies when a
 * multiplier (> 1) is actually in effect, so ordinary staves are unaffected.
 * Single source of truth for the live (combat.js), idle (idleEngine.js) and PvP
 * (combatPrimitives.js) magic paths.
 */
export function getEffectiveWornMagicDamage(baseMagicDamage, equipment, itemsData) {
  const mult = getWeaponMagicDamageMultiplier(equipment, itemsData)
  let value = (Number(baseMagicDamage) || 0) * mult
  if (mult > 1) {
    const weaponEntry = equipment?.weapon
    const weapon = weaponEntry ? itemsData?.[weaponEntry.itemId] : null
    const cap = Number(weapon?.magicDamageMultiplierCap)
    if (Number.isFinite(cap) && cap > 0) value = Math.min(value, cap)
  }
  return value
}

/**
 * Get the attack speed of the equipped weapon (default 4 ticks unarmed)
 */
export function getAttackSpeed(equipment, itemsData) {
  if (!equipment.weapon) return 4
  const weapon = itemsData[equipment.weapon.itemId]
  return weapon?.attackSpeed || 4
}

/**
 * Get the attack style of the equipped weapon
 */
export function getAttackStyle(equipment, itemsData) {
  if (!equipment.weapon) return 'crush' // unarmed
  const weapon = itemsData[equipment.weapon.itemId]
  return weapon?.attackStyle || 'crush'
}

/**
 * Attack-style key for a MELEE swing with the equipped weapon: a magic
 * weapon (e.g. a staff fighting with no spell selected — see
 * resolveMagicSpell) swings as crush rather than indexing the nonexistent
 * melee entry under the raw 'magic' style key.
 */
export function getMeleeAttackStyle(equipment, itemsData) {
  const style = getAttackStyle(equipment, itemsData)
  return style === 'magic' ? 'crush' : style
}

/**
 * Get the combat type based on the equipped weapon's attack style
 * Returns 'melee', 'ranged', or 'magic'
 */
export function getCombatType(equipment, itemsData) {
  if (!equipment || !equipment.weapon) return 'melee'
  const weapon = itemsData[equipment.weapon.itemId]
  if (!weapon) return 'melee'

  const attackStyle = weapon.attackStyle || 'crush'
  if (attackStyle === 'ranged') return 'ranged'
  if (attackStyle === 'magic') return 'magic'
  return 'melee'
}

/**
 * Resolve the spell object a magic fight will actually cast, and flag when a
 * magic fight is missing one (`needsSpell`). `combatType` here is the RAW
 * weapon-driven type — still 'magic' when `needsSpell` is true. Callers that
 * run an actual fight (`combat.js`, `idleEngine.js`) fall back to melee (with
 * the weapon's melee bonuses) whenever `needsSpell` is true, rather than
 * splashing 0s forever with no spell to cast; the fallback switches back to
 * real magic the instant a spell is selected.
 *
 * `spell` is resolved from `spellsData` by the stored spell id, so a persisted
 * id that no longer exists (e.g. renamed in a content update) resolves to null
 * and is treated as "no spell" rather than silently splashing forever.
 */
export function resolveMagicSpell(equipment, itemsData, activeCombatSpell, spellsData) {
  const combatType = getCombatType(equipment, itemsData)
  const weaponItem = equipment?.weapon ? itemsData?.[equipment.weapon.itemId] : null
  const isPoweredStaff = !!weaponItem?.poweredStaff
  const spell = combatType === 'magic' && activeCombatSpell && !isPoweredStaff
    ? (spellsData?.[activeCombatSpell.id] || null)
    : null
  const needsSpell = combatType === 'magic' && !spell && !isPoweredStaff
  return { combatType, weaponItem, isPoweredStaff, spell, needsSpell }
}
