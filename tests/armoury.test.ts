import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'
import {
  buildArmoury,
  categoryOf,
  tierOf,
  groupKeyOf,
  isSkillCape,
  hasSpecialAttack,
  hasPositiveCombatBonus,
  SKILL_CAPES_GROUP_KEY,
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
    expect(groupKeyOf({ name: "Ava's Accumulator", slot: 'cape', requirements: { ranged: 50 } })).toBe('avas')
  })

  it('treats only level-99 single-skill capes as skill capes', () => {
    expect(isSkillCape({ slot: 'cape', name: 'Attack Cape', requirements: { attack: 99 } })).toBe(true)
    expect(isSkillCape({ slot: 'cape', name: 'Mining Cape', requirements: { mining: 99 } })).toBe(true)
    expect(isSkillCape({ slot: 'cape', name: 'Fire Cape', requirements: {} })).toBe(false)
    expect(isSkillCape({ slot: 'cape', name: "Ava's Accumulator", requirements: { ranged: 50 } })).toBe(false)
    expect(isSkillCape({ slot: 'weapon', name: 'Dragon Scimitar', requirements: { attack: 60 } })).toBe(false)
    // Skill capes all collapse into one group regardless of skill name.
    expect(groupKeyOf({ slot: 'cape', name: 'Attack Cape', requirements: { attack: 99 } })).toBe(SKILL_CAPES_GROUP_KEY)
    expect(groupKeyOf({ slot: 'cape', name: 'Thieving Cape', requirements: { thieving: 99 } })).toBe(SKILL_CAPES_GROUP_KEY)
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
    const groups = buildArmoury(items)

    it('returns one flat, tier-ordered list of groups', () => {
      expect(Array.isArray(groups)).toBe(true)
      for (let i = 1; i < groups.length; i++) {
        expect(groups[i].minTier).toBeGreaterThanOrEqual(groups[i - 1].minTier)
      }
      for (const group of groups) {
        for (let i = 1; i < group.items.length; i++) {
          expect(tierOf(group.items[i])).toBeGreaterThanOrEqual(tierOf(group.items[i - 1]))
        }
      }
    })

    it('surfaces the named families requested (dragon, runeforged, grondar)', () => {
      const keys = groups.map(g => g.key)
      expect(keys).toContain('dragon')
      expect(keys).toContain('runeforged')
      expect(keys).toContain('grondar')
    })

    it('collapses all max-level skill capes into a single Skill Capes group at the end', () => {
      const capeGroups = groups.filter(g => g.key === SKILL_CAPES_GROUP_KEY)
      expect(capeGroups.length).toBe(1)
      const capes = capeGroups[0]
      expect(capes.label).toBe('Skill Capes')
      expect(capes.items.length).toBe(17) // attack…thieving
      expect(capes.items.every(isSkillCape)).toBe(true)
      // tier 99 → last group in the list
      expect(groups[groups.length - 1].key).toBe(SKILL_CAPES_GROUP_KEY)
    })

    it('lists every positive-bonus item exactly once across groups', () => {
      let total = 0
      const ids = new Set<string>()
      for (const group of groups) {
        expect(group.key).toBeTruthy()
        expect(group.label).toBeTruthy()
        for (const item of group.items) {
          expect(hasPositiveCombatBonus(item)).toBe(true)
          ids.add(item.id)
          total++
        }
      }
      expect(total).toBe(ids.size) // no duplicates
      const expected = Object.values(items).filter(hasPositiveCombatBonus).length
      expect(total).toBe(expected)
    })
  })
})
