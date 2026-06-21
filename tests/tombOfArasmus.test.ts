import { describe, expect, it } from 'vitest'
import raidsData from '../src/data/raids.json'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'
import { getCollectionLogData } from '../src/engine/collectionLog.js'

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
