import { describe, expect, it } from 'vitest'
import collectionLog from '../src/data/collectionLog.json' assert { type: 'json' }
import items from '../src/data/items.json' assert { type: 'json' }
import monsters from '../src/data/monsters.json' assert { type: 'json' }
import raids from '../src/data/raids.json' assert { type: 'json' }

const itemsData = items as Record<string, any>
const monstersData = monsters as Record<string, any>
const raidsData = raids as Record<string, any>

// The mobile combat info/raid sheets read their gilded "unique" panels straight
// from the collection log (not inferred from drop rarity). Guard that data so a
// rename never leaves the sheet showing raw ids.
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

  it('raid bosses all resolve to real monsters (for the chamber timeline)', () => {
    for (const raid of Object.values(raidsData)) {
      for (const bossId of (raid as any).bosses) {
        expect(monstersData[bossId], `${(raid as any).id} boss ${bossId}`).toBeTruthy()
      }
    }
  })
})
