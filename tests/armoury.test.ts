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
import { getBreakdownYield } from '../src/engine/inventory.js'

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

  it('derives tier from the highest requirement (0 when unrestricted)', () => {
    expect(tierOf({ requirements: { attack: 60, strength: 60 } })).toBe(60)
    expect(tierOf({ requirements: { defence: 1 } })).toBe(1)
    expect(tierOf({})).toBe(0)
    // A secondary gate never understates the tier: it is the level you must
    // reach to wield the item, not the cheapest requirement on it.
    expect(tierOf({ requirements: { attack: 80, strength: 90, dungeoneering: 80 } })).toBe(90)
    expect(tierOf({ requirements: { ranged: 60, defence: 1 } })).toBe(60)
  })

  it('tiers the live Dungeoneering and hide gear at the level that actually gates it', () => {
    // Chaotic gear is claimed at Dungeoneering 80 but wielded at 90.
    for (const id of ['chaotic_rapier', 'chaotic_longsword', 'chaotic_maul', 'chaotic_crossbow', 'chaotic_staff']) {
      expect([id, tierOf(items[id])]).toEqual([id, 90])
    }
    expect(tierOf(items.red_d_hide_body)).toBe(60)
    expect(tierOf(items.masari_mask)).toBe(80)
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
    // Non-weapon skill-yield jewellery (any slot) → Skilling, not Melee, even
    // though it has zero attack/defence bonus and would otherwise fall
    // through categoryOf's melee default.
    expect(typeFilterOf({ type: 'armour', slot: 'gloves', otherBonus: { runecraftYieldPercent: 100 } })).toBe('skilling')
    expect(typeFilterOf(items.bracelet_of_runecrafting)).toBe('skilling')
    expect(typeFilterOf(items.bracelet_of_smithing)).toBe('skilling')
    // A plain gloves item with zero bonuses and no skilling key stays melee.
    expect(typeFilterOf({ type: 'armour', slot: 'gloves', otherBonus: {} })).toBe('melee')
  })

  it('describes how an item is obtained from the live data', () => {
    const has = (id: string, re: RegExp) => describeObtainment(items[id]).some((s) => re.test(s))
    // Smithed / crafted product.
    expect(has('bronze_dagger', /Made with Smithing/)).toBe(true)
    // Gem stolen from Tzraar.
    expect(has('sapphire', /Stolen from/)).toBe(true)
    // Combine recipe names both parts (crystal + base boots).
    expect(describeObtainment(items['skyfury_boots'])).toContain('Forged by combining Skyfury Crystal with Pathfinder Boots')
    // Clue-reward items say clue scrolls, never "bought from a shop".
    const pathfinder = describeObtainment(items['pathfinder_boots'])
    expect(pathfinder.some((s) => /clue scrolls/.test(s))).toBe(true)
    expect(pathfinder.some((s) => /shop/i.test(s))).toBe(false)
    // Raid uniques credit the raid, not a boss drop table.
    expect(has('fang_of_osmun', /Reward from the .* raid/)).toBe(true)
    expect(has('fang_of_osmun', /Dropped by/)).toBe(false)
    // Minigame set (rewardItems), slayer-point unlock, skill cape.
    expect(has('void_king_helm', /Earned from/)).toBe(true)
    expect(has('slayer_helmet', /Slayer points/)).toBe(true)
    expect(has('attack_cape', /level 99/)).toBe(true)
  })

  it('gives every equippable item at least one obtainment source', () => {
    for (const item of Object.values(items).filter(isEquippable)) {
      expect(describeObtainment(item).length, `no source for ${item.name}`).toBeGreaterThan(0)
    }
  })

  it('flags weapons that have a special attack (33 canonical items)', () => {
    // Existing specials plus Twinflare Chakrams' Division — deliberate content
    // additions, not classifier drift.
    const specials = Object.values(items).filter(hasSpecialAttack)
    expect(specials.length).toBe(33)
    expect(specials.some((item: any) => item.id === 'twinflare_chakrams')).toBe(true)
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
      expect(capes.items.length).toBe(18) // attack…thieving + summoning
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

describe('breaking venom gear down into venomcoil scales', () => {
  it.each(['venom_blowpipe', 'trident_of_venom', 'serpentine_helm'])(
    '%s breaks down into 7500 venomcoil scales',
    (id) => {
      expect(getBreakdownYield(items[id])).toEqual({ itemId: 'venomcoil_scales', qty: 7500 })
    },
  )
})
