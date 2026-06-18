import { describe, it, expect } from 'vitest'
import items from '../src/data/items.json'
import { getEquipmentBonuses } from '../src/engine/equipment.js'

const itemsData = items as Record<string, any>

describe('max cape', () => {
  const cape = itemsData.max_cape

  it('is an untradeable, maxed-account cape priced at 1B', () => {
    expect(cape.slot).toBe('cape')
    expect(cape.type).toBe('armour')
    expect(cape.isMaxCape).toBe(true)
    expect(cape.isUntradeable).toBe(true)
    expect(cape.shopValue).toBe(1_000_000_000)
  })

  it('gives +10 to every attack and defence bonus and no strength', () => {
    for (const style of ['stab', 'slash', 'crush', 'magic', 'ranged']) {
      expect(cape.attackBonus[style]).toBe(10)
      expect(cape.defenceBonus[style]).toBe(10)
    }
    expect(cape.otherBonus.meleeStrength).toBe(0)
    expect(cape.otherBonus.rangedStrength).toBe(0)
    expect(cape.otherBonus.magicDamage).toBe(0)
  })

  it('aggregates its bonuses when equipped', () => {
    const equipment = { cape: { itemId: 'max_cape' } }
    const bonuses = getEquipmentBonuses(equipment, itemsData)
    expect(bonuses.attackBonus.slash).toBe(10)
    expect(bonuses.defenceBonus.magic).toBe(10)
    expect(bonuses.otherBonus.meleeStrength).toBe(0)
  })
})

describe('infernal max cape', () => {
  const cape = itemsData.infernal_max_cape

  it('is an untradeable cape obtained only by combining (not sold)', () => {
    expect(cape.slot).toBe('cape')
    expect(cape.isUntradeable).toBe(true)
    expect(cape.isMaxCape).toBeUndefined()
    expect(cape.shopValue).toBe(0)
  })

  it('gives +25 to every attack and defence bonus and +20 to all strengths', () => {
    for (const style of ['stab', 'slash', 'crush', 'magic', 'ranged']) {
      expect(cape.attackBonus[style]).toBe(25)
      expect(cape.defenceBonus[style]).toBe(25)
    }
    expect(cape.otherBonus.meleeStrength).toBe(20)
    expect(cape.otherBonus.rangedStrength).toBe(20)
    expect(cape.otherBonus.magicDamage).toBe(20)
  })

  it('is created by using an infernal cape on a max cape (both consumed)', () => {
    const infernal = itemsData.infernal_cape
    expect(infernal.combineWith).toBe('max_cape')
    expect(infernal.combineResult).toBe('infernal_max_cape')
  })

  it('aggregates its bonuses when equipped', () => {
    const equipment = { cape: { itemId: 'infernal_max_cape' } }
    const bonuses = getEquipmentBonuses(equipment, itemsData)
    expect(bonuses.attackBonus.crush).toBe(25)
    expect(bonuses.defenceBonus.ranged).toBe(25)
    expect(bonuses.otherBonus.rangedStrength).toBe(20)
    expect(bonuses.otherBonus.magicDamage).toBe(20)
  })
})
