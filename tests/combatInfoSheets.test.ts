import { describe, expect, it } from 'vitest'
import collectionLog from '../src/data/collectionLog.json' assert { type: 'json' }
import items from '../src/data/items.json' assert { type: 'json' }
import monsters from '../src/data/monsters.json' assert { type: 'json' }
import raids from '../src/data/raids.json' assert { type: 'json' }
import { raidInfoStages, raidUniqueChanceRange } from '../src/engine/raidEncounters.js'

const itemsData = items as Record<string, any>
const monstersData = monsters as Record<string, any>
const raidsData = raids as Record<string, any>

// The mobile combat info/raid sheets read their gilded "unique" panels straight
// from the collection log (not inferred from drop rarity). Guard that data so a
// rename never leaves the sheet showing raw ids.
function raidEncounterMonsterIds(raid: any) {
  const ids = new Set<string>(raid?.bosses || [])
  for (const id of raid?.encounterOnlyMonsters || []) ids.add(id)
  for (const wave of raid?.waves || []) {
    if (wave?.primary) ids.add(wave.primary)
    for (const id of wave?.initialAdds || []) ids.add(id)
    for (const group of wave?.reinforcements || []) {
      for (const id of group?.monsterIds || []) ids.add(id)
    }
  }
  return [...ids]
}

function section(categoryId: string, sectionId: string) {
  const cat = (collectionLog as any).categories.find((c: any) => c.id === categoryId)
  return cat?.sections.find((s: any) => s.id === sectionId)
}

describe('combat info sheets — collection-log sourced uniques', () => {
  it('every collection-log monster/raid unique resolves to a real item', () => {
    const missing: string[] = []
    for (const catId of ['monsters', 'raids']) {
      const cat = (collectionLog as any).categories.find((c: any) => c.id === catId)
      for (const s of cat.sections) {
        for (const itemId of s.items) {
          if (!itemsData[itemId]) missing.push(`${catId}/${s.id}: ${itemId}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('every collection-log monster section maps to a real monster', () => {
    const cat = (collectionLog as any).categories.find((c: any) => c.id === 'monsters')
    const orphan = cat.sections.map((s: any) => s.id).filter((id: string) => !monstersData[id])
    expect(orphan).toEqual([])
  })

  it('every raid id has a matching collection-log section', () => {
    const uniqueRaids = [...new Set(Object.values(raidsData).map((r: any) => r.id))]
    for (const id of uniqueRaids) {
      expect(section('raids', id as string)).toBeTruthy()
    }
  })

  it('every authored raid encounter monster resolves to real content', () => {
    for (const raid of Object.values(raidsData)) {
      for (const monsterId of raidEncounterMonsterIds(raid)) {
        expect(monstersData[monsterId], `${(raid as any).id} encounter ${monsterId}`).toBeTruthy()
      }
    }
  })
})

describe('black dragon', () => {
  it('logs Dragon Visage and Dragon Full Helm as collection-log uniques', () => {
    const bd = section('monsters', 'black_dragon')
    expect(bd).toBeTruthy()
    expect(bd.items).toEqual(expect.arrayContaining(['dragon_visage', 'dragon_full_helm']))
  })

  it('carries each unique in the drop table at its rate (so the info sheet can show it)', () => {
    const drops = monstersData.black_dragon.drops
    const byId: Record<string, any> = Object.fromEntries(drops.map((d: any) => [d.itemId, d]))
    expect(byId.dragon_visage?.chance).toBeCloseTo(1 / 20000)
    expect(byId.dragon_full_helm?.chance).toBeCloseTo(1 / 25000)
  })

  it('is enhanced over the red dragon: black leather + dragon armour, no red leather', () => {
    const byId: Record<string, any> = Object.fromEntries(
      monstersData.black_dragon.drops.map((d: any) => [d.itemId, d]),
    )
    expect(byId.black_dragon_leather?.chance).toBe(1)
    expect(byId.red_dragon_leather).toBeUndefined()
    expect(byId.dragon_platelegs).toBeTruthy()
    expect(byId.dragon_plateskirt).toBeTruthy()
  })

  it('mirrors the red dragon OSRS combat stats baseline (enhanced)', () => {
    const bd = monstersData.black_dragon
    expect(bd.combatLevel).toBe(227)
    expect(bd.hitpoints).toBe(200)
    expect(bd.specialAttack).toBe('dragonfire')
  })
})


describe('wave raid info model', () => {
  it('describes Sunspire without requiring a legacy bosses array', () => {
    const raid: any = raidsData.sunspire_colosseum
    expect(raid.bosses).toBeUndefined()
    const stages = raidInfoStages(raid, monstersData)
    expect(stages).toHaveLength(6)
    expect(stages[0]).toMatchObject({ kind: 'wave', label: 'Wave 1', primaryId: 'ashen_warband_blade', startingEnemyCount: 6, reinforcementCount: 1 })
    expect(stages[5]).toMatchObject({ kind: 'wave', label: 'Wave 6', primaryId: 'aurelios_the_unbroken', startingEnemyCount: 1, reinforcementCount: 0 })
  })

  it('surfaces Sunspire unique odds from the first eligible wave through the final wave', () => {
    expect(raidUniqueChanceRange(raidsData.sunspire_colosseum)).toEqual({
      first: { wave: 1, chance: 1 / 82 },
      last: { wave: 6, chance: 1 / 12 },
    })
  })
})
