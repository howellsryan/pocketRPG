import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'
import {
  buildArmoury,
  categoryOf,
  tierOf,
  kindOf,
  groupKeyOf,
  isSkillCape,
  hasSpecialAttack,
  hasPositiveCombatBonus,
  isEquippable,
  typeFilterOf,
  describeObtainment,
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

  it('groups by item kind (the noun in the name), not material family', () => {
    // Same kind across materials shares a group.
    expect(groupKeyOf({ name: 'Dragon Scimitar' })).toBe('scimitar')
    expect(groupKeyOf({ name: 'Bronze Scimitar' })).toBe('scimitar')
    expect(groupKeyOf({ name: 'Magic Shortbow' })).toBe('shortbow')
    expect(groupKeyOf({ name: 'Yew Longbow' })).toBe('longbow')
    expect(groupKeyOf({ name: 'Rune Crossbow' })).toBe('crossbow')
    expect(groupKeyOf({ name: 'Runeforged Platebody' })).toBe('platebody')
  })

  it('kindOf handles "<Kind> of <X>" names and parenthetical variants', () => {
    expect(kindOf({ name: 'Amulet of Glory' })).toBe('Amulet')
    expect(kindOf({ name: 'Amulet of Glory (T)' })).toBe('Amulet')
    expect(kindOf({ name: 'Staff of Fire' })).toBe('Staff')
    expect(kindOf({ name: 'Trident of Venom' })).toBe('Trident')
    expect(kindOf({ name: 'Climbing Boots (G)' })).toBe('Boots')
    expect(kindOf({ name: 'Magic Shortbow' })).toBe('Shortbow')
    // jewellery amulets and "Amulet of X" land in the same group
    expect(groupKeyOf({ name: 'Sapphire Amulet' })).toBe('amulet')
    expect(groupKeyOf({ name: 'Amulet of Fury' })).toBe('amulet')
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

  it('includes items with a positive attack, defence or combat other-bonus', () => {
    expect(hasPositiveCombatBonus({ attackBonus: { stab: 5 } })).toBe(true)
    expect(hasPositiveCombatBonus({ defenceBonus: { magic: 3 } })).toBe(true)
    // strength / ranged-strength / magic-damage are combat stats too.
    expect(hasPositiveCombatBonus({ otherBonus: { meleeStrength: 9 } })).toBe(true)
    expect(hasPositiveCombatBonus({ otherBonus: { rangedStrength: 7 } })).toBe(true)
    expect(hasPositiveCombatBonus({ otherBonus: { magicDamage: 4 } })).toBe(true)
    // non-combat other-bonuses (skilling XP, prayer) do not qualify.
    expect(hasPositiveCombatBonus({ otherBonus: { fishingXpPercent: 10 } })).toBe(false)
    expect(hasPositiveCombatBonus({ otherBonus: { prayer: 3 } })).toBe(false)
    expect(hasPositiveCombatBonus({ attackBonus: { stab: 0, slash: -2 } })).toBe(false)
    expect(hasPositiveCombatBonus({})).toBe(false)
  })

  it('the Armoury includes anything equippable, combat gear or not', () => {
    expect(isEquippable({ slot: 'weapon' })).toBe(true)
    expect(isEquippable({ slot: 'ring' })).toBe(true)
    expect(isEquippable({ slot: 'ammo' })).toBe(true)
    // A fishing rod / spade with no combat stat still counts.
    expect(isEquippable({ slot: 'weapon', type: 'weapon', requirements: { fishing: 20 } })).toBe(true)
    // Non-equippable resources / consumables do not.
    expect(isEquippable({ type: 'resource' })).toBe(false)
    expect(isEquippable({ slot: null })).toBe(false)
    expect(isEquippable(null)).toBe(false)
  })

  it('type filter: Skilling holds skill capes and gathering tools, not combat gear', () => {
    // Gathering-tool weapons → Skilling.
    expect(typeFilterOf({ type: 'weapon', attackStyle: 'stab', requirements: { attack: 60, mining: 60 } })).toBe('skilling')
    expect(typeFilterOf({ type: 'weapon', attackStyle: 'slash', requirements: { attack: 60, woodcutting: 60 } })).toBe('skilling')
    expect(typeFilterOf({ type: 'weapon', slot: 'weapon', requirements: { fishing: 50 } })).toBe('skilling')
    // Tools with no requirement, detected by kind (spade) or skilling bonus / type.
    expect(typeFilterOf({ type: 'weapon', slot: 'weapon', name: 'Gold Spade', requirements: {} })).toBe('skilling')
    expect(typeFilterOf({ type: 'weapon', slot: 'weapon', name: 'Angler Net', otherBonus: { fishingXpPercent: 10 } })).toBe('skilling')
    expect(typeFilterOf({ type: 'tool', slot: 'weapon', name: 'Shardglass Pickaxe' })).toBe('skilling')
    // Skill capes now file under Skilling.
    expect(typeFilterOf({ slot: 'cape', name: 'Mining Cape', requirements: { mining: 99 } })).toBe('skilling')
    // Pure combat gear falls back to its combat category.
    expect(typeFilterOf({ type: 'weapon', attackStyle: 'stab', requirements: { attack: 60 } })).toBe('melee')
    expect(typeFilterOf({ type: 'weapon', attackStyle: 'ranged' })).toBe('ranged')
    expect(typeFilterOf({ type: 'weapon', attackStyle: 'magic' })).toBe('magic')
    // A combat "axe" (no gathering req) stays melee — kind alone must not misfile it.
    expect(typeFilterOf({ type: 'weapon', slot: 'weapon', attackStyle: 'slash', name: 'Emberhowl Axe', requirements: { attack: 60 } })).toBe('melee')
    // Slayer/Dungeoneering gate combat gear, not tools — never Skilling.
    expect(typeFilterOf({ type: 'weapon', attackStyle: 'stab', requirements: { attack: 80, strength: 90, dungeoneering: 80 } })).toBe('melee')
    expect(typeFilterOf({ type: 'weapon', attackStyle: 'magic', requirements: { magic: 90, dungeoneering: 80 } })).toBe('magic')
    expect(typeFilterOf({ type: 'armour', slot: 'shield', requirements: { slayer: 85, attack: 50, strength: 85 } })).toBe('melee')
    expect(typeFilterOf({ type: 'armour', slot: 'gloves', requirements: { attack: 80, strength: 80, defence: 80, slayer: 95 } })).toBe('melee')
  })

  it('describes how an item is obtained from the live data', () => {
    // Bronze dagger is smithed.
    const dagger = describeObtainment(items['bronze_dagger'])
    expect(dagger.some((s) => /Made with Smithing/.test(s))).toBe(true)
    // A gem stolen from Tzraar surfaces the thieving source.
    const sapphire = describeObtainment(items['sapphire'])
    expect(sapphire.some((s) => /Stolen from/.test(s))).toBe(true)
  })

  it('flags weapons that have a special attack (25 canonical items)', () => {
    const specials = Object.values(items).filter(hasSpecialAttack)
    expect(specials.length).toBe(25)
  })

  describe('buildArmoury over the live data', () => {
    const groups = buildArmoury(items)

    it('returns one flat list ordered alphabetically by label (Skill Capes last), items by tier', () => {
      expect(Array.isArray(groups)).toBe(true)
      const ordinary = groups.filter(g => g.key !== SKILL_CAPES_GROUP_KEY)
      for (let i = 1; i < ordinary.length; i++) {
        expect(ordinary[i].label.localeCompare(ordinary[i - 1].label)).toBeGreaterThanOrEqual(0)
      }
      for (const group of groups) {
        for (let i = 1; i < group.items.length; i++) {
          expect(tierOf(group.items[i])).toBeGreaterThanOrEqual(tierOf(group.items[i - 1]))
        }
      }
    })

    it('groups the kinds requested (shortbow, longbow, crossbow, amulet) across materials', () => {
      const byKey = Object.fromEntries(groups.map(g => [g.key, g]))
      for (const kind of ['shortbow', 'longbow', 'crossbow', 'amulet']) {
        expect(byKey[kind], `missing kind group ${kind}`).toBeTruthy()
        expect(byKey[kind].items.length).toBeGreaterThan(1)
      }
      // a kind spans materials (bronze … dragon dagger together)
      const daggerNames = (byKey['dagger']?.items || []).map((i: any) => i.name)
      expect(daggerNames.some((n: string) => /bronze/i.test(n))).toBe(true)
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

    it('lists every equippable item exactly once across groups', () => {
      let total = 0
      const ids = new Set<string>()
      for (const group of groups) {
        expect(group.key).toBeTruthy()
        expect(group.label).toBeTruthy()
        for (const item of group.items) {
          expect(isEquippable(item)).toBe(true)
          ids.add(item.id)
          total++
        }
      }
      expect(total).toBe(ids.size) // no duplicates
      const expected = Object.values(items).filter(isEquippable).length
      expect(total).toBe(expected)
    })

    it('includes equippable items that carry no combat stat (fishing tools, cosmetics)', () => {
      const all = new Set<string>()
      for (const group of groups) for (const item of group.items) all.add(item.name)
      for (const name of ['Angler Net', 'Harpoon', 'Gold Spade', 'Red Partyhat']) {
        expect(all.has(name), `missing ${name}`).toBe(true)
      }
    })
  })
})
