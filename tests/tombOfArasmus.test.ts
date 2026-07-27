import { describe, expect, it } from 'vitest'
import raidsData from '../src/data/raids.json'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'
import { getCollectionLogData } from '../src/engine/collectionLog.js'
import { getCombatSetMultipliers } from '../src/engine/combatSetBonuses.js'
import { getWeaponMagicDamageMultiplier, getEffectiveWornMagicDamage } from '../src/engine/equipment.js'
import { getRaidArt } from '../src/utils/combatArt.js'
import { getItemIconTint } from '../src/utils/itemIcons.js'
import { COMBAT_POTION_RANGED_BOOST, COMBAT_POTION_MAGIC_BOOST } from '../src/engine/consumables.js'

const UNIQUE_IDS = [
  'fang_of_osmun',
  'sunbearer_ring',
  'ward_of_elidria',
  'masari_mask',
  'masari_body',
  'masari_chaps',
  'shadow_of_tumaken',
]

describe('Tomb of Arasmus raid', () => {
  const raid = (raidsData as any).tomb_of_arasmus

  it('exists with the canonical id, skip cost, and legacy alias', () => {
    expect(raid).toBeTruthy()
    expect(raid.id).toBe('tomb_of_arasmus')
    expect(raid.skipCost).toBe(10)
    expect(raid.legacy_id).toBe('tombs_of_amascut')
    // legacy alias key points back to the canonical id (mirrors other raids)
    const alias = (raidsData as any).tombs_of_amascut
    expect(alias).toBeTruthy()
    expect(alias.id).toBe('tomb_of_arasmus')
  })

  it('clears four path bosses before the inferno-style Warden finale', () => {
    expect(raid.bosses).toEqual([
      'khareth_the_shadowbound',
      'gorroth_the_mountain_ape',
      'khepra_the_scarab_matron',
      'sebakh_the_devourer',
      'warden_of_arasmus',
    ])
    for (const id of raid.bosses) {
      expect((monstersData as any)[id], `monster ${id} must exist`).toBeTruthy()
    }
  })

  it('Warden attacks every 2 ticks and switches a random style every 3 hits', () => {
    const warden = (monstersData as any).warden_of_arasmus
    expect(warden.attackSpeed).toBe(2)
    expect(warden.multiForm).toBe(true)
    // min === max === 3 makes the form switch threshold land on exactly 3 attacks
    expect(warden.formSwitchMin).toBe(3)
    expect(warden.formSwitchMax).toBe(3)
    // no formCycleOrder + no randomFormEveryAttack => pickNextForm is random
    expect(warden.formCycleOrder).toBeUndefined()
    expect(warden.randomFormEveryAttack).toBeUndefined()
    expect(Object.keys(warden.forms)).toEqual(expect.arrayContaining(['magic', 'ranged', 'melee']))
  })

  it('rolls a unique at 1/15 overall, weighted with Shadow rarest', () => {
    expect(raid.rewards.unique.chance).toBeCloseTo(1 / 15, 6)
    const items = raid.rewards.unique.items as { itemId: string; weight: number }[]
    expect(items.map(i => i.itemId).sort()).toEqual([...UNIQUE_IDS].sort())
    const weightOf = (id: string) => items.find(i => i.itemId === id)!.weight
    // OSRS relative ordering: Fang/Lightbearer most common, Shadow rarest
    expect(weightOf('shadow_of_tumaken')).toBeLessThan(weightOf('masari_mask'))
    expect(weightOf('masari_mask')).toBeLessThan(weightOf('ward_of_elidria'))
    expect(weightOf('ward_of_elidria')).toBeLessThan(weightOf('fang_of_osmun'))
    expect(weightOf('fang_of_osmun')).toBe(weightOf('sunbearer_ring'))
  })

  it('every unique exists as a boss-unique item with requirements and a shop value', () => {
    for (const id of UNIQUE_IDS) {
      const item = (itemsData as any)[id]
      expect(item, `item ${id} must exist`).toBeTruthy()
      expect(item.isBossUnique).toBe(true)
      expect(item.legacy_item_id).toBeTruthy()
      expect(item.requirements).toBeTruthy()
      expect(typeof item.shopValue).toBe('number')
      expect(item.shopValue).toBeGreaterThan(0)
    }
  })

  it('lists exactly the 7 uniques in the collection log, matching the drop table', () => {
    const data = getCollectionLogData()
    const raids = data.categories.find((c: any) => c.id === 'raids')
    const section = raids?.sections.find((s: any) => s.id === 'tomb_of_arasmus')
    expect(section).toBeTruthy()
    expect([...section.items].sort()).toEqual([...UNIQUE_IDS].sort())
    // section id must equal the raid id so server-side log grants validate
    expect(section.id).toBe(raid.id)
  })
})

describe('Tomb of Arasmus item effects', () => {
  const fullMasari = {
    head: { itemId: 'masari_mask' },
    body: { itemId: 'masari_body' },
    legs: { itemId: 'masari_chaps' },
  }

  it('Fang of Osmun carries a fang special attack', () => {
    const fang = (itemsData as any).fang_of_osmun
    expect(fang.specialAttack).toBeTruthy()
    expect(fang.specialAttack.type).toBe('fang')
    expect(fang.specialAttack.energyCost).toBe(25)
  })

  it('full Masari set grants a ranged set bonus via the shared set engine', () => {
    const none = getCombatSetMultipliers({})
    expect(none.rangedDamage).toBe(1)
    expect(none.rangedAccuracy).toBe(1)
    const full = getCombatSetMultipliers(fullMasari)
    expect(full.rangedDamage).toBeCloseTo(1.1, 6)
    expect(full.rangedAccuracy).toBeCloseTo(1.1, 6)
    // melee/magic untouched by Masari
    expect(full.meleeDamage).toBe(1)
    expect(full.magicAccuracy).toBe(1)
  })

  it('a partial Masari set grants no bonus', () => {
    const partial = { head: { itemId: 'masari_mask' }, body: { itemId: 'masari_body' } }
    const mult = getCombatSetMultipliers(partial)
    expect(mult.rangedDamage).toBe(1)
    expect(mult.rangedAccuracy).toBe(1)
  })

  it('Shadow of Tumaken triples worn magic damage through the shared weapon helper', () => {
    const shadow = (itemsData as any).shadow_of_tumaken
    expect(shadow.poweredStaff).toBe(true)
    expect(shadow.magicDamageMultiplier).toBe(3)
    const equip = { weapon: { itemId: 'shadow_of_tumaken' } }
    expect(getWeaponMagicDamageMultiplier(equip, itemsData as any)).toBe(3)
    // a non-multiplier weapon returns 1
    expect(getWeaponMagicDamageMultiplier({ weapon: { itemId: 'fang_of_osmun' } }, itemsData as any)).toBe(1)
    expect(getWeaponMagicDamageMultiplier({}, itemsData as any)).toBe(1)
  })

  it('Shadow of Tumaken uses a unique wizard-staff icon', () => {
    expect((itemsData as any).shadow_of_tumaken.iconId).toBe('wizard_staff')
  })

  it('Shadow of Tumaken is scale-charged with a 5 Chaos + 2 Soul rune recipe', () => {
    const shadow = (itemsData as any).shadow_of_tumaken
    expect(shadow.scaleCharged).toBe(true)
    expect(shadow.chargeRecipe).toEqual([
      { itemId: 'chaos_rune', qty: 5 },
      { itemId: 'soul_rune', qty: 2 },
    ])
    // every recipe ingredient must be a real item
    for (const r of shadow.chargeRecipe) {
      expect((itemsData as any)[r.itemId], `charge item ${r.itemId} must exist`).toBeTruthy()
    }
  })

  it('caps the Shadow of Tumaken tripled magic damage at its authored ceiling', () => {
    const shadow = (itemsData as any).shadow_of_tumaken
    // The game's priciest weapon, so the cap is set above OSRS parity (+100%)
    // to keep it the strongest magic weapon rather than a slower Trident.
    const cap = shadow.magicDamageMultiplierCap
    expect(cap).toBeGreaterThan(100)
    const equip = { weapon: { itemId: 'shadow_of_tumaken' } }
    // worn × 3, clamped to the cap
    expect(getEffectiveWornMagicDamage(99, equip, itemsData as any)).toBe(cap)
    // below the cap the full tripled value still applies (20 × 3 = 60)
    expect(getEffectiveWornMagicDamage(20, equip, itemsData as any)).toBe(60)
    // a non-multiplier weapon is never capped and never scaled
    expect(getEffectiveWornMagicDamage(99, { weapon: { itemId: 'fang_of_osmun' } }, itemsData as any)).toBe(99)
    expect(getEffectiveWornMagicDamage(0, equip, itemsData as any)).toBe(0)
  })

  it('super combat potion grants ranged/magic boosts matching the dedicated potions', () => {
    expect(COMBAT_POTION_RANGED_BOOST).toBe((itemsData as any).ranging_potion.boost)
    expect(COMBAT_POTION_MAGIC_BOOST).toBe((itemsData as any).magic_potion.boost)
    expect((itemsData as any).super_combat.effect).toBe('combat')
  })
})

describe('Tomb of Arasmus presentation', () => {
  it('has its own raid art, distinct from Vaults of Xyren', () => {
    const toa = getRaidArt('tomb_of_arasmus')
    const vaults = getRaidArt('vaults_of_xyren')
    expect(toa.icon).not.toBe(vaults.icon)
    expect(toa.accent).not.toBe(vaults.accent)
    // not the generic fallback either
    expect(toa.icon).toBe('crowned_skull')
  })

  it('renders the Masari set with a black icon body', () => {
    for (const id of ['masari_mask', 'masari_body', 'masari_chaps']) {
      expect(getItemIconTint((itemsData as any)[id])).toBe('#111111')
    }
  })
})

describe('Masari ranged stat buff', () => {
  const cases = [
    { id: 'masari_mask', ranged: 18, shopValue: 100000000 },
    { id: 'masari_body', ranged: 64, shopValue: 375000000 },
    { id: 'masari_chaps', ranged: 33, shopValue: 250000000 },
  ]
  for (const { id, ranged, shopValue } of cases) {
    it(`${id} has the boosted ranged attack, +2 ranged strength, and updated shop value`, () => {
      const item = (itemsData as any)[id]
      expect(item.attackBonus.ranged).toBe(ranged)
      expect(item.otherBonus.rangedStrength).toBe(2)
      expect(item.shopValue).toBe(shopValue)
    })
  }
})

describe('Tomb of Arasmus shop values', () => {
  const expected: Record<string, number> = {
    shadow_of_tumaken: 1500000000,
    fang_of_osmun: 75000000,
    ward_of_elidria: 50000000,
    sunbearer_ring: 15000000,
    masari_body: 375000000,
    masari_chaps: 250000000,
    masari_mask: 100000000,
  }
  for (const [id, value] of Object.entries(expected)) {
    it(`${id} is worth ${value}`, () => {
      expect((itemsData as any)[id].shopValue).toBe(value)
    })
  }
})
