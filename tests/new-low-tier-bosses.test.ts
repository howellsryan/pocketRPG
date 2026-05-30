import { describe, it, expect } from 'vitest'
import monsters from '../src/data/monsters.json' assert { type: 'json' }
import items from '../src/data/items.json' assert { type: 'json' }
import { getCollectionLogData, isLoggedDrop } from '../src/engine/collectionLog.js'

const NEW_BOSS_IDS = [
  'gravehusk_brute',
  'boneclaw_revenant',
  'shroudwraith_specter',
  'stonegale_elemental',
  'cindermaw_serpent',
  'thornhide_colossus',
  'gravethorn_drake',
  'ironclad_guardian',
  'emberhowl_warlord',
  'razorwing_harpy',
]

const BOSS_UNIQUES: Record<string, string[]> = {
  gravehusk_brute: ['gravehusk_helm', 'gravehusk_platebody'],
  boneclaw_revenant: ['boneclaw_rapier', 'boneclaw_shield'],
  shroudwraith_specter: ['shroud_robes_top', 'shroud_staff'],
  stonegale_elemental: ['stonegale_bow', 'stonegale_coif'],
  cindermaw_serpent: ['cindermaw_maul', 'cindermaw_scale_body'],
  thornhide_colossus: ['thornhide_platelegs', 'thornhide_gauntlets'],
  gravethorn_drake: ['thornspine_shortbow', 'drake_leather_body'],
  ironclad_guardian: ['ironclad_longsword', 'ironclad_helm'],
  emberhowl_warlord: ['emberhowl_axe', 'emberhowl_boots'],
  razorwing_harpy: ['razorwing_crossbow', 'razorwing_vambraces'],
}

describe('new low-tier bosses — data integrity', () => {
  it('all 10 new bosses exist in monstersData', () => {
    for (const id of NEW_BOSS_IDS) {
      expect((monsters as any)[id], `${id} missing from monsters.json`).toBeTruthy()
    }
  })

  it('all new bosses are flagged boss: true', () => {
    for (const id of NEW_BOSS_IDS) {
      expect((monsters as any)[id].boss, `${id}.boss should be true`).toBe(true)
    }
  })

  it('no new boss has a slayerRequirement', () => {
    for (const id of NEW_BOSS_IDS) {
      const boss = (monsters as any)[id]
      expect(boss.slayerRequirement, `${id} must not have slayerRequirement`).toBeUndefined()
    }
  })

  it('all new bosses have combatLevel in the ~80-160 range', () => {
    for (const id of NEW_BOSS_IDS) {
      const cb = (monsters as any)[id].combatLevel
      expect(cb, `${id} combatLevel should be >= 80`).toBeGreaterThanOrEqual(80)
      expect(cb, `${id} combatLevel should be <= 160`).toBeLessThanOrEqual(160)
    }
  })

  it('every drop itemId on every new boss resolves to a real item', () => {
    for (const id of NEW_BOSS_IDS) {
      const boss = (monsters as any)[id]
      for (const drop of boss.drops) {
        expect((items as any)[drop.itemId], `Boss ${id} references unknown itemId "${drop.itemId}"`).toBeTruthy()
      }
    }
  })

  it('all new unique items exist in items.json with isBossUnique: true', () => {
    for (const uniques of Object.values(BOSS_UNIQUES)) {
      for (const itemId of uniques) {
        const item = (items as any)[itemId]
        expect(item, `${itemId} missing from items.json`).toBeTruthy()
        expect(item.isBossUnique, `${itemId}.isBossUnique should be true`).toBe(true)
      }
    }
  })

  it('all new unique items have a primary requirement in the ~level 60 range (max req 55-65)', () => {
    for (const uniques of Object.values(BOSS_UNIQUES)) {
      for (const itemId of uniques) {
        const item = (items as any)[itemId]
        if (!item.requirements) continue
        const maxReq = Math.max(...Object.values(item.requirements as Record<string, number>))
        expect(maxReq, `${itemId} max requirement should be >= 55`).toBeGreaterThanOrEqual(55)
        expect(maxReq, `${itemId} max requirement should be <= 65`).toBeLessThanOrEqual(65)
      }
    }
  })

  it('all new unique items have a positive shopValue', () => {
    for (const uniques of Object.values(BOSS_UNIQUES)) {
      for (const itemId of uniques) {
        const item = (items as any)[itemId]
        expect(item.shopValue, `${itemId} should have shopValue > 0`).toBeGreaterThan(0)
      }
    }
  })

  it('weapons with special attacks have the correct new spec types', () => {
    const expectedSpecs: Record<string, string> = {
      boneclaw_rapier: 'soul_leech',
      stonegale_bow: 'gale_shot',
      cindermaw_maul: 'molten_crush',
      thornspine_shortbow: 'volley',
    }
    for (const [itemId, specType] of Object.entries(expectedSpecs)) {
      const item = (items as any)[itemId]
      expect(item?.specialAttack?.type, `${itemId} should have spec type ${specType}`).toBe(specType)
    }
  })
})

describe('new low-tier bosses — collection log', () => {
  const logData = getCollectionLogData()
  const monstersCategory = logData.categories.find((c: any) => c.id === 'monsters')

  it('monsters collection log category exists', () => {
    expect(monstersCategory).toBeTruthy()
  })

  it('every new boss has a section in the collection log', () => {
    for (const bossId of NEW_BOSS_IDS) {
      const section = monstersCategory?.sections.find((s: any) => s.id === bossId)
      expect(section, `No collection log section for boss "${bossId}"`).toBeTruthy()
    }
  })

  it('each boss section lists its correct unique drops', () => {
    for (const [bossId, uniques] of Object.entries(BOSS_UNIQUES)) {
      const section = monstersCategory?.sections.find((s: any) => s.id === bossId)
      for (const itemId of uniques) {
        expect(section?.items, `${bossId} section missing "${itemId}"`).toContain(itemId)
      }
    }
  })

  it('isLoggedDrop returns true for all new boss uniques', () => {
    for (const [bossId, uniques] of Object.entries(BOSS_UNIQUES)) {
      for (const itemId of uniques) {
        expect(
          isLoggedDrop(itemId, 'monsters', bossId),
          `isLoggedDrop should be true for ${itemId} in ${bossId}`
        ).toBe(true)
      }
    }
  })
})
