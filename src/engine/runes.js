/**
 * Get the elemental staff equipped by the player (if any)
 * @param {object} equipment - equipment state
 * @param {object} itemsData - items.json lookup
 * @returns {object|null} the elemental staff item data or null
 */
export function getEquippedElementalStaff(equipment, itemsData) {
  if (!equipment?.weapon) return null
  const staff = itemsData[equipment.weapon.itemId]
  return (staff && staff.elemental) ? staff : null
}

/**
 * Check if player has the required runes considering equipped elemental staffs
 * @param {object} runeReq - { runeId: quantity } object
 * @param {array} inventory - player inventory
 * @param {object} bank - bank items
 * @param {object} equipment - equipment state
 * @param {object} itemsData - items.json lookup
 * @returns {boolean} true if all runes are available
 */
export function hasRequiredRunes(runeReq, inventory, bank, equipment, itemsData) {
  if (!runeReq) return true
  if (!inventory || !Array.isArray(inventory)) return true
  if (!bank || typeof bank !== 'object') return true

  const staff = getEquippedElementalStaff(equipment, itemsData)
  const staffRuneType = staff?.elemental

  for (const [runeId, qty] of Object.entries(runeReq)) {
    // If this rune type is provided by the equipped staff, skip the check
    if (staffRuneType === runeId) continue

    const invCount = inventory.reduce((sum, slot) => sum + (slot?.itemId === runeId ? (slot?.quantity || 1) : 0), 0)
    const bankCount = bank[runeId]?.quantity || 0
    if (invCount + bankCount < qty) {
      return false
    }
  }
  return true
}

/**
 * Get the runes that need to be consumed considering equipped elemental staffs
 * Returns a filtered runeReq object excluding runes provided by the staff
 * @param {object} runeReq - { runeId: quantity } object
 * @param {object} equipment - equipment state
 * @param {object} itemsData - items.json lookup
 * @returns {object} filtered runes to consume
 */
export function getRunesToConsume(runeReq, equipment, itemsData) {
  if (!runeReq || typeof runeReq !== 'object') return {}
  if (!itemsData || typeof itemsData !== 'object') return runeReq

  const staff = getEquippedElementalStaff(equipment, itemsData)
  const staffRuneType = staff?.elemental

  const toConsume = {}
  for (const [runeId, qty] of Object.entries(runeReq)) {
    // Skip runes provided by the staff
    if (staffRuneType === runeId) continue
    toConsume[runeId] = qty
  }
  return toConsume
}

/**
 * Count a specific rune in inventory, considering equipped elemental staffs
 * @param {string} runeId - the rune to count
 * @param {array} inventory - player inventory
 * @param {object} equipment - equipment state
 * @param {object} itemsData - items.json lookup
 * @returns {number} count of the rune (infinite if provided by staff)
 */
export function countRune(runeId, inventory, equipment, itemsData) {
  const staff = getEquippedElementalStaff(equipment, itemsData)
  if (staff?.elemental === runeId) {
    return Infinity // Unlimited rune from staff
  }
  return inventory.reduce((sum, slot) => sum + (slot?.itemId === runeId ? (slot?.quantity || 1) : 0), 0)
}
