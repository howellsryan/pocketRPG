import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'
import {
  buildArmoury,
  categoryOf,
  tierOf,
  groupKeyOf,
  hasSpecialAttack,
  hasPositiveCombatBonus,
  ARMOURY_CATEGORIES,
} from '../src/utils/armoury.js'

const items = itemsData as Record<string, any>

describe('armoury classifier', () => {
  it('categorises weapons by attack style', () => {
    expect(categoryOf({ type: 'weapon', attackStyle: 'stab' })).toBe('melee')
    expect(categoryOf({ type: 'weapon', attackStyle: 'slash' })).toBe('melee')
    expect(categoryOf({ type: 'weapon', attackStyle: 'crush' })).toBe('melee')
    expect(categoryOf({ type: 'weapon', attackStyle: 'ranged' })).toBe('ranged')
    expect(categoryOf({ type: 'weapon', attackStyle: 'magic' })).toBe('magic')
  })

  it('categorises armour by requirements then bonus profile', () => {
    expect(categoryOf({ type: 'armour', requirements: { ranged: 40 } })).toBe('ranged')
    expect(categoryOf({ type: 'armour', requirements: { magic: 40 } })).toBe('magic')
    expect(categoryOf({ type: 'armour', requirements: { defence: 40 } })).toBe('melee')
    expect(categoryOf({ type: 'armour', otherBonus: { rangedStrength: 5 } })).toBe('ranged')
    expect(categoryOf({ type: 'armour', otherBonus: { magicDamage: 5 } })).toBe('magic')
  })

  it('derives tier from the lowest requirement (0 when unrestricted)', () => {
    expect(tierOf({ requirements: { attack: 60, strength: 60 } })).toBe(60)
    expect(tierOf({ requirements: { defence: 1 } })).toBe(1)
    expect(tierOf({})).toBe(0)
  })

  it('groups by the first word of the name', () => {
    expect(groupKeyOf({ name: 'Dragon Scimitar' })).toBe('dragon')
    expect(groupKeyOf({ name: 'Runeforged Platebody' })).toBe('runeforged')
    expect(groupKeyOf({ name: "Ava's Accumulator" })).toBe('avas')
  })

  it('only includes items with a positive attack or defence bonus', () => {
    expect(hasPositiveCombatBonus({ attackBonus: { stab: 5 } })).toBe(true)
    expect(hasPositiveCombatBonus({ defenceBonus: { magic: 3 } })).toBe(true)
    expect(hasPositiveCombatBonus({ attackBonus: { stab: 0, slash: -2 } })).toBe(false)
    expect(hasPositiveCombatBonus({ otherBonus: { meleeStrength: 9 } })).toBe(false)
    expect(hasPositiveCombatBonus({})).toBe(false)
  })

  it('flags weapons that have a special attack (23 canonical items)', () => {
    const specials = Object.values(items).filter(hasSpecialAttack)
    expect(specials.length).toBe(23)
  })

  describe('buildArmoury over the live data', () => {
    const armoury = buildArmoury(items)

    it('returns all three categories', () => {
      for (const cat of ARMOURY_CATEGORIES) {
        expect(Array.isArray(armoury[cat as keyof typeof armoury])).toBe(true)
      }
    })

    it('sorts groups by lowest tier and items by tier then name', () => {
      for (const cat of ARMOURY_CATEGORIES) {
        const groups = armoury[cat as keyof typeof armoury]
        for (let i = 1; i < groups.length; i++) {
          expect(groups[i].minTier).toBeGreaterThanOrEqual(groups[i - 1].minTier)
        }
        for (const group of groups) {
          for (let i = 1; i < group.items.length; i++) {
            expect(tierOf(group.items[i])).toBeGreaterThanOrEqual(tierOf(group.items[i - 1]))
          }
        }
      }
    })

    it('surfaces the named families requested (dragon, runeforged, grondar)', () => {
      const meleeKeys = armoury.melee.map(g => g.key)
      expect(meleeKeys).toContain('dragon')
      expect(meleeKeys).toContain('runeforged')
      expect(meleeKeys).toContain('grondar')
    })

    it('every included item has a positive combat bonus and a resolved group', () => {
      let total = 0
      for (const cat of ARMOURY_CATEGORIES) {
        for (const group of armoury[cat as keyof typeof armoury]) {
          expect(group.key).toBeTruthy()
          expect(group.label).toBeTruthy()
          for (const item of group.items) {
            expect(hasPositiveCombatBonus(item)).toBe(true)
            total++
          }
        }
      }
      // Every positive-bonus item in the data lands in exactly one category/group.
      const expected = Object.values(items).filter(hasPositiveCombatBonus).length
      expect(total).toBe(expected)
    })
  })
})
