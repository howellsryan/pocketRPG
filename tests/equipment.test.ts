import { describe, it, expect, beforeEach } from 'vitest'
import {
  createEquipment,
  isAmmoCompatible,
  equipItem,
  unequipSlot,
  getEquipmentBonuses,
  getAttackSpeed,
  getAttackStyle,
  getCombatType
} from '../src/engine/equipment.js'

// Mock items data structure
const mockItemsData = {
  'sword': {
    id: 'sword',
    name: 'Sword',
    slot: 'weapon',
    attackStyle: 'slash',
    attackSpeed: 4,
    attackBonus: { slash: 10, stab: 5 },
    defenceBonus: { stab: 0, slash: 5, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 5 }
  },
  'shield': {
    id: 'shield',
    name: 'Shield',
    slot: 'shield',
    defenceBonus: { stab: 10, slash: 10, crush: 10, magic: 5, ranged: 10 },
    otherBonus: {}
  },
  '2h_sword': {
    id: '2h_sword',
    name: '2H Sword',
    slot: 'weapon',
    twoHanded: true,
    attackStyle: 'slash',
    attackSpeed: 8,
    attackBonus: { slash: 20 },
    defenceBonus: { slash: 10 },
    otherBonus: { meleeStrength: 10 }
  },
  'bow': {
    id: 'bow',
    name: 'Bow',
    slot: 'weapon',
    attackStyle: 'ranged',
    attackSpeed: 5,
    ammoType: 'arrow',
    attackBonus: { ranged: 15 },
    defenceBonus: { ranged: 5 },
    otherBonus: { rangedStrength: 5 }
  },
  'arrow': {
    id: 'arrow',
    name: 'Arrow',
    slot: 'ammo',
    ammoKind: 'arrow',
    attackBonus: { ranged: 1 },
    otherBonus: { rangedStrength: 1 }
  },
  'bolt': {
    id: 'bolt',
    name: 'Bolt',
    slot: 'ammo',
    ammoKind: 'bolt',
    attackBonus: { ranged: 2 },
    otherBonus: { rangedStrength: 2 }
  },
  'staff': {
    id: 'staff',
    name: 'Staff',
    slot: 'weapon',
    attackStyle: 'magic',
    attackSpeed: 5,
    attackBonus: { magic: 10 },
    otherBonus: { magicDamage: 15 }
  },
  'helmet': {
    id: 'helmet',
    name: 'Helmet',
    slot: 'head',
    defenceBonus: { stab: 2, slash: 2, crush: 2, magic: 1, ranged: 2 },
    otherBonus: {}
  }
}

describe('Equipment System', () => {
  let equipment: any

  beforeEach(() => {
    equipment = createEquipment()
  })

  describe('createEquipment', () => {
    it('should create equipment with all slots null', () => {
      const eq = createEquipment()
      expect(eq.head).toBeNull()
      expect(eq.body).toBeNull()
      expect(eq.legs).toBeNull()
      expect(eq.weapon).toBeNull()
      expect(eq.shield).toBeNull()
      expect(eq.gloves).toBeNull()
      expect(eq.boots).toBeNull()
      expect(eq.cape).toBeNull()
      expect(eq.neck).toBeNull()
      expect(eq.ring).toBeNull()
      expect(eq.ammo).toBeNull()
    })

    it('should have 11 slots', () => {
      const eq = createEquipment()
      expect(Object.keys(eq).length).toBe(11)
    })
  })

  describe('isAmmoCompatible', () => {
    it('should return true if no weapon equipped', () => {
      const ammo = mockItemsData['arrow']
      const result = isAmmoCompatible(equipment, ammo, mockItemsData)
      expect(result).toBe(true)
    })

    it('should return true if items lack type info', () => {
      equipment.weapon = { itemId: 'sword' }
      const ammo = { id: 'test' } // No ammoKind
      const result = isAmmoCompatible(equipment, ammo, mockItemsData)
      expect(result).toBe(true)
    })

    it('should match compatible ammo type', () => {
      equipment.weapon = { itemId: 'bow' }
      const arrow = mockItemsData['arrow']
      const result = isAmmoCompatible(equipment, arrow, mockItemsData)
      expect(result).toBe(true)
    })

    it('should reject incompatible ammo type', () => {
      equipment.weapon = { itemId: 'bow' } // Needs arrows
      const bolt = mockItemsData['bolt'] // Trying to equip bolts
      const result = isAmmoCompatible(equipment, bolt, mockItemsData)
      expect(result).toBe(false)
    })
  })

  describe('equipItem', () => {
    it('should equip item to empty slot', () => {
      const result = equipItem(equipment, mockItemsData['sword'], mockItemsData)
      expect(result.equipped).toBe(true)
      expect(equipment.weapon.itemId).toBe('sword')
      expect(result.unequipped).toEqual([])
    })

    it('should replace existing item in slot', () => {
      equipItem(equipment, mockItemsData['helmet'], mockItemsData)
      const result = equipItem(equipment, mockItemsData['helmet'], mockItemsData)

      expect(result.equipped).toBe(true)
      expect(equipment.head.itemId).toBe('helmet')
      expect(result.unequipped.length).toBeGreaterThan(0)
      expect(result.unequipped[0].itemId).toBe('helmet')
    })

    it('should clear shield when equipping 2H weapon', () => {
      equipItem(equipment, mockItemsData['shield'], mockItemsData)
      const result = equipItem(equipment, mockItemsData['2h_sword'], mockItemsData)

      expect(result.equipped).toBe(true)
      expect(equipment.weapon.itemId).toBe('2h_sword')
      expect(equipment.shield).toBeNull()
      expect(result.unequipped.length).toBeGreaterThan(0)
    })

    it('should clear 2H weapon when equipping shield', () => {
      equipItem(equipment, mockItemsData['2h_sword'], mockItemsData)
      const result = equipItem(equipment, mockItemsData['shield'], mockItemsData)

      expect(result.equipped).toBe(true)
      expect(equipment.shield.itemId).toBe('shield')
      expect(equipment.weapon).toBeNull()
    })

    it('should handle ammo compatibility check', () => {
      equipItem(equipment, mockItemsData['bow'], mockItemsData)
      const resultArrow = equipItem(equipment, mockItemsData['arrow'], mockItemsData)
      expect(resultArrow.equipped).toBe(true)

      const resultBolt = equipItem(equipment, mockItemsData['bolt'], mockItemsData)
      expect(resultBolt.equipped).toBe(false)
      expect(resultBolt.reason).toBe('wrong_ammo_type')
    })

    it('should reject invalid slot', () => {
      const invalidItem = { id: 'invalid', slot: 'nonexistent' }
      const result = equipItem(equipment, invalidItem, mockItemsData)
      expect(result.equipped).toBe(false)
    })
  })

  describe('unequipSlot', () => {
    it('should unequip item and return it', () => {
      equipItem(equipment, mockItemsData['sword'], mockItemsData)
      const result = unequipSlot(equipment, 'weapon')

      expect(result.itemId).toBe('sword')
      expect(equipment.weapon).toBeNull()
    })

    it('should return null for empty slot', () => {
      const result = unequipSlot(equipment, 'weapon')
      expect(result).toBeNull()
    })

    it('should work for any slot', () => {
      equipItem(equipment, mockItemsData['helmet'], mockItemsData)
      const result = unequipSlot(equipment, 'head')

      expect(result.itemId).toBe('helmet')
      expect(equipment.head).toBeNull()
    })
  })

  describe('getEquipmentBonuses', () => {
    it('should return zero bonuses for empty equipment', () => {
      const bonuses = getEquipmentBonuses(equipment, mockItemsData)

      expect(bonuses.attackBonus.stab).toBe(0)
      expect(bonuses.defenceBonus.stab).toBe(0)
      expect(bonuses.otherBonus.meleeStrength).toBe(0)
    })

    it('should aggregate single item bonuses', () => {
      equipItem(equipment, mockItemsData['sword'], mockItemsData)
      const bonuses = getEquipmentBonuses(equipment, mockItemsData)

      expect(bonuses.attackBonus.slash).toBe(10)
      expect(bonuses.defenceBonus.slash).toBe(5)
      expect(bonuses.otherBonus.meleeStrength).toBe(5)
    })

    it('should aggregate multiple items', () => {
      equipItem(equipment, mockItemsData['sword'], mockItemsData)
      equipItem(equipment, mockItemsData['helmet'], mockItemsData)
      const bonuses = getEquipmentBonuses(equipment, mockItemsData)

      expect(bonuses.defenceBonus.stab).toBe(2) // helmet only
      expect(bonuses.defenceBonus.slash).toBe(5 + 2) // sword + helmet
    })

    it('should handle weapon + shield combo', () => {
      equipItem(equipment, mockItemsData['sword'], mockItemsData)
      equipItem(equipment, mockItemsData['shield'], mockItemsData)
      const bonuses = getEquipmentBonuses(equipment, mockItemsData)

      expect(bonuses.attackBonus.slash).toBe(10)
      expect(bonuses.defenceBonus.stab).toBe(10) // Only shield
      expect(bonuses.defenceBonus.slash).toBe(5 + 10) // sword + shield
    })

    it('should handle missing itemsData gracefully', () => {
      equipment.weapon = { itemId: 'nonexistent' }
      const bonuses = getEquipmentBonuses(equipment, mockItemsData)
      expect(bonuses.attackBonus.stab).toBe(0)
    })

    it('should create otherBonus keys as needed', () => {
      equipItem(equipment, mockItemsData['bow'], mockItemsData)
      equipItem(equipment, mockItemsData['arrow'], mockItemsData)
      const bonuses = getEquipmentBonuses(equipment, mockItemsData)

      expect(bonuses.otherBonus.rangedStrength).toBe(5 + 1) // bow + arrow
    })
  })

  describe('getAttackSpeed', () => {
    it('should return 4 ticks unarmed', () => {
      const speed = getAttackSpeed(equipment, mockItemsData)
      expect(speed).toBe(4)
    })

    it('should return weapon attack speed', () => {
      equipItem(equipment, mockItemsData['sword'], mockItemsData)
      const speed = getAttackSpeed(equipment, mockItemsData)
      expect(speed).toBe(4)
    })

    it('should return 2H weapon speed', () => {
      equipItem(equipment, mockItemsData['2h_sword'], mockItemsData)
      const speed = getAttackSpeed(equipment, mockItemsData)
      expect(speed).toBe(8)
    })

    it('should default to 4 if no speed specified', () => {
      equipment.weapon = { itemId: 'unknown_weapon' }
      const speed = getAttackSpeed(equipment, mockItemsData)
      expect(speed).toBe(4)
    })
  })

  describe('getAttackStyle', () => {
    it('should return crush unarmed', () => {
      const style = getAttackStyle(equipment, mockItemsData)
      expect(style).toBe('crush')
    })

    it('should return weapon attack style', () => {
      equipItem(equipment, mockItemsData['sword'], mockItemsData)
      const style = getAttackStyle(equipment, mockItemsData)
      expect(style).toBe('slash')
    })

    it('should return ranged for ranged weapons', () => {
      equipItem(equipment, mockItemsData['bow'], mockItemsData)
      const style = getAttackStyle(equipment, mockItemsData)
      expect(style).toBe('ranged')
    })

    it('should return magic for magic weapons', () => {
      equipItem(equipment, mockItemsData['staff'], mockItemsData)
      const style = getAttackStyle(equipment, mockItemsData)
      expect(style).toBe('magic')
    })

    it('should default to crush for unknown weapons', () => {
      equipment.weapon = { itemId: 'unknown' }
      const style = getAttackStyle(equipment, mockItemsData)
      expect(style).toBe('crush')
    })
  })

  describe('getCombatType', () => {
    it('should return melee when unarmed', () => {
      const type = getCombatType(equipment, mockItemsData)
      expect(type).toBe('melee')
    })

    it('should return melee for melee weapons', () => {
      equipItem(equipment, mockItemsData['sword'], mockItemsData)
      const type = getCombatType(equipment, mockItemsData)
      expect(type).toBe('melee')
    })

    it('should return ranged for ranged weapons', () => {
      equipItem(equipment, mockItemsData['bow'], mockItemsData)
      const type = getCombatType(equipment, mockItemsData)
      expect(type).toBe('ranged')
    })

    it('should return magic for magic weapons', () => {
      equipItem(equipment, mockItemsData['staff'], mockItemsData)
      const type = getCombatType(equipment, mockItemsData)
      expect(type).toBe('magic')
    })

    it('should return melee for 2H weapons', () => {
      equipItem(equipment, mockItemsData['2h_sword'], mockItemsData)
      const type = getCombatType(equipment, mockItemsData)
      expect(type).toBe('melee')
    })

    it('should handle null equipment gracefully', () => {
      const type = getCombatType(null, mockItemsData)
      expect(type).toBe('melee')
    })
  })

  describe('Integration - Common Workflows', () => {
    it('should handle melee setup', () => {
      equipItem(equipment, mockItemsData['sword'], mockItemsData)
      equipItem(equipment, mockItemsData['shield'], mockItemsData)
      equipItem(equipment, mockItemsData['helmet'], mockItemsData)

      const combatType = getCombatType(equipment, mockItemsData)
      const speed = getAttackSpeed(equipment, mockItemsData)
      const bonuses = getEquipmentBonuses(equipment, mockItemsData)

      expect(combatType).toBe('melee')
      expect(speed).toBe(4)
      expect(bonuses.attackBonus.slash).toBeGreaterThan(0)
      expect(bonuses.defenceBonus.stab).toBeGreaterThan(0)
    })

    it('should handle ranged setup', () => {
      equipItem(equipment, mockItemsData['bow'], mockItemsData)
      equipItem(equipment, mockItemsData['arrow'], mockItemsData)

      const combatType = getCombatType(equipment, mockItemsData)
      const style = getAttackStyle(equipment, mockItemsData)
      const bonuses = getEquipmentBonuses(equipment, mockItemsData)

      expect(combatType).toBe('ranged')
      expect(style).toBe('ranged')
      expect(bonuses.otherBonus.rangedStrength).toBeGreaterThan(0)
    })

    it('should handle magic setup', () => {
      equipItem(equipment, mockItemsData['staff'], mockItemsData)

      const combatType = getCombatType(equipment, mockItemsData)
      const bonuses = getEquipmentBonuses(equipment, mockItemsData)

      expect(combatType).toBe('magic')
      expect(bonuses.otherBonus.magicDamage).toBeGreaterThan(0)
    })

    it('should switch from 2H to sword+shield', () => {
      equipItem(equipment, mockItemsData['2h_sword'], mockItemsData)
      expect(equipment.weapon.itemId).toBe('2h_sword')
      expect(equipment.shield).toBeNull()

      equipItem(equipment, mockItemsData['sword'], mockItemsData)
      equipItem(equipment, mockItemsData['shield'], mockItemsData)

      expect(equipment.weapon.itemId).toBe('sword')
      expect(equipment.shield.itemId).toBe('shield')
    })
  })
})
