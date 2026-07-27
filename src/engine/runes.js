// Slots that can supply an element's rune for free. The weapon slot holds the
// elemental staves; the shield slot holds the tomes (Tomb of Fire). Ordered —
// the first match wins, so a staff and a tome of the same element don't stack
// (there is nothing to stack: an unlimited supply is already unlimited).
const RUNE_SOURCE_SLOTS = ['weapon', 'shield']

/**
 * Get the equipped item that supplies an element's rune for free — an elemental
 * staff (weapon) or an elemental tome (shield).
 * @param {object} equipment - equipment state
 * @param {object} itemsData - items.json lookup
 * @returns {object|null} the item data of the rune source, or null
 */
export function getEquippedElementalStaff(equipment, itemsData) {
  for (const slot of RUNE_SOURCE_SLOTS) {
    const entry = equipment?.[slot]
    if (!entry) continue
    const item = itemsData?.[entry.itemId]
    if (item?.elemental) return item
  }
  return null
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
  if (!runeReq) return {}

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
