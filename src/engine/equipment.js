import { EQUIPMENT_SLOTS } from '../utils/constants.js'

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
  if (!weapon || !weapon.ammoType || !ammoItemData.ammoKind) return true
  return weapon.ammoType === ammoItemData.ammoKind
}

/**
 * Equip an item. Returns { equipped: true, unequipped: [] } or { equipped: false, reason }
 * Handles 2H weapon / shield conflicts and ammo-weapon type validation.
 */
export function equipItem(equipment, itemData, itemsData) {
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

  equipment[slot] = {
    itemId: itemData.id,
    _twoHanded: itemData.twoHanded || false
  }

  return { equipped: true, unequipped }
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
        bonuses.otherBonus[k] = (bonuses.otherBonus[k] || 0) + v
      }
    }
  }

  return bonuses
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
