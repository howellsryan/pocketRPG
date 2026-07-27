// What a duellist is allowed to ask for. Lives here rather than in the route
// because the PvP match room validates against its own live state, not against
// a state blob read back out of D1.

import { isConsumableFood, isConsumablePotion } from '../../src/engine/consumables.js'
import { getEquippedPvpSpecialAttack, hasEnoughPvpSpecialEnergy } from '../../src/engine/pvpSpecialAttacks.js'
import { hasRequiredRunes } from '../../src/engine/runes.js'
import spellsData from '../../src/data/spells.json' assert { type: 'json' }
import prayersData from '../../src/data/prayers.json' assert { type: 'json' }
import { itemsData } from './pvpMatch.js'

const VALID_STANCES = new Set(['accurate', 'aggressive', 'defensive', 'controlled', 'rapid', 'longrange'])
const PROTECTION_PRAYER_IDS = new Set(['protection_from_magic', 'protection_from_missiles', 'protection_from_melee'])

export function validateIntentAction(state, characterId, action) {
  const combatant = state?.combatants?.[String(characterId)]
  if (!combatant || !action || typeof action !== 'object') {
    return { ok: false, error: 'invalid_action' }
  }

  if (action.type === 'forfeit') return { ok: true }

  if (action.type === 'queue_special') {
    if (combatant.specialAttackQueued) return { ok: true }
    const equipped = getEquippedPvpSpecialAttack(combatant, itemsData)
    if (!equipped) return { ok: false, error: 'no_special_attack' }
    if (!hasEnoughPvpSpecialEnergy(combatant, itemsData)) return { ok: false, error: 'insufficient_special_energy' }
    return { ok: true }
  }

  if (action.type === 'change_stance') {
    return VALID_STANCES.has(action.stance)
      ? { ok: true }
      : { ok: false, error: 'invalid_stance' }
  }

  if (action.type === 'change_combat_spell') {
    if (action.spellId === null) return { ok: true }
    const spell = spellsData?.[action.spellId]
    if (!spell) return { ok: false, error: 'invalid_spell' }
    if ((combatant?.stats?.magic || 1) < (spell.levelReq || 1)) {
      return { ok: false, error: 'insufficient_magic_level' }
    }
    // Validate runes the same way the engine does: an equipped elemental staff
    // supplies its element rune for free; all other runes must be in inventory
    // (bank is not consulted in combat — the {}). Matches resolveMagicSwing.
    if (!hasRequiredRunes(spell.runeReq, combatant.inventory || [], {}, combatant.equipment, itemsData)) {
      return { ok: false, error: 'insufficient_runes' }
    }
    return { ok: true }
  }

  if (action.type === 'toggle_prayer') {
    if (typeof action.prayerId !== 'string') {
      return { ok: false, error: 'invalid_prayer' }
    }
    const prayer = prayersData?.[action.prayerId]
    if (!prayer) return { ok: false, error: 'invalid_prayer' }
    if (prayer.bonusType === 'protection' || PROTECTION_PRAYER_IDS.has(action.prayerId)) {
      return { ok: false, error: 'protection_prayer_disabled' }
    }
    if ((combatant?.stats?.prayer || 1) < (prayer.level || 1)) {
      return { ok: false, error: 'insufficient_prayer_level' }
    }
    return { ok: true }
  }

  if (action.type === 'equip' || action.type === 'eat' || action.type === 'drink_potion') {
    const i = action.inventorySlot
    if (!Number.isInteger(i) || i < 0 || i >= (combatant.inventory?.length || 0)) {
      return { ok: false, error: 'invalid_inventory_slot' }
    }
    const slot = combatant.inventory[i]
    if (!slot) return { ok: false, error: 'empty_inventory_slot' }
    const item = itemsData?.[slot.itemId]
    if (!item) return { ok: false, error: 'unknown_item' }
    if (action.type === 'equip') return item.slot ? { ok: true } : { ok: false, error: 'item_not_equippable' }
    if (action.type === 'eat') return isConsumableFood(item) ? { ok: true } : { ok: false, error: 'item_not_food' }
    return isConsumablePotion(item) ? { ok: true } : { ok: false, error: 'item_not_potion' }
  }

  if (action.type === 'unequip') {
    const slot = action.equipmentSlot
    if (!slot || !combatant.equipment?.[slot]) {
      return { ok: false, error: 'invalid_equipment_slot' }
    }
    return { ok: true }
  }

  return { ok: false, error: 'unsupported_action' }
}
