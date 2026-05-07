import { describe, it, expect } from 'vitest'
import {
  getCollectionLogData,
  getCollectionLogTotal,
  isLoggedDrop,
  filterLoggedDrops,
  summarizeProgress,
  summarizeSection,
} from '../src/engine/collectionLog.js'

describe('collection log data', () => {
  const data = getCollectionLogData()

  it('exposes a versioned schema with the four expected categories', () => {
    expect(data.version).toBeTypeOf('number')
    const categoryIds = data.categories.map((c: any) => c.id)
    expect(categoryIds).toEqual(expect.arrayContaining(['monsters', 'raids', 'minigames', 'clues']))
  })

  it('every section declares at least one item, no duplicates within a section', () => {
    for (const cat of data.categories) {
      for (const sec of cat.sections) {
        expect(sec.items.length).toBeGreaterThan(0)
        const set = new Set(sec.items)
        expect(set.size).toBe(sec.items.length)
      }
    }
  })

  it('total count equals the sum of every section', () => {
    let counted = 0
    for (const cat of data.categories) {
      for (const sec of cat.sections) counted += sec.items.length
    }
    expect(getCollectionLogTotal()).toBe(counted)
  })

  it('isLoggedDrop returns true only for (category, section, item) triples that exist', () => {
    const firstCat = data.categories[0]
    const firstSec = firstCat.sections[0]
    const itemId = firstSec.items[0]
    expect(isLoggedDrop(itemId, firstCat.id, firstSec.id)).toBe(true)
    expect(isLoggedDrop(itemId, firstCat.id, 'no_such_section')).toBe(false)
    expect(isLoggedDrop('no_such_item', firstCat.id, firstSec.id)).toBe(false)
    expect(isLoggedDrop(itemId, 'no_such_category', firstSec.id)).toBe(false)
  })

  it('filterLoggedDrops keeps only items in the named section and dedupes by itemId', () => {
    const firstCat = data.categories[0]
    const firstSec = firstCat.sections[0]
    const known = firstSec.items[0]
    const drops = [
      { itemId: known, quantity: 1 },
      { itemId: known, quantity: 1 },          // dupe
      { itemId: 'nonexistent', quantity: 1 },  // not in section
    ]
    const filtered = filterLoggedDrops(drops, firstCat.id, firstSec.id)
    expect(filtered).toEqual([known])
  })

  it('summarizeProgress reports 0/total when nothing collected', () => {
    const summary = summarizeProgress(new Set())
    expect(summary.obtained).toBe(0)
    expect(summary.total).toBe(getCollectionLogTotal())
  })

  it('summarizeProgress reaches total/total when every entry is owned', () => {
    const owned = new Set<string>()
    for (const cat of data.categories) {
      for (const sec of cat.sections) {
        for (const itemId of sec.items) owned.add(`${cat.id}:${sec.id}:${itemId}`)
      }
    }
    const summary = summarizeProgress(owned)
    expect(summary.obtained).toBe(summary.total)
    expect(summary.total).toBe(getCollectionLogTotal())
  })

  it('summarizeSection only counts entries under that section', () => {
    const cat = data.categories.find((c: any) => c.sections.length >= 2) || data.categories[0]
    const [a, b] = cat.sections
    const owned = new Set<string>()
    for (const itemId of a.items) owned.add(`${cat.id}:${a.id}:${itemId}`)
    expect(summarizeSection(owned, cat.id, a.id, a.items)).toEqual({ obtained: a.items.length, total: a.items.length })
    if (b) {
      expect(summarizeSection(owned, cat.id, b.id, b.items)).toEqual({ obtained: 0, total: b.items.length })
    }
  })

  it('rejects an empty / missing entries set without throwing', () => {
    expect(summarizeProgress(null as any)).toEqual({ obtained: 0, total: getCollectionLogTotal() })
    expect(summarizeSection(null as any, 'x', 'y', ['z'])).toEqual({ obtained: 0, total: 1 })
  })
})

describe('collection log seeded contents', () => {
  const data = getCollectionLogData()
  const findCategory = (id: string) => data.categories.find((c: any) => c.id === id)

  it('Gargoyle is one of the monster sources for Granite Maul', () => {
    const monsters = findCategory('monsters')
    const gargoyle = monsters?.sections.find((s: any) => s.id === 'gargoyle')
    expect(gargoyle).toBeTruthy()
    expect(gargoyle.items).toContain('granite_maul')
  })

  it('Chambers of Xeric lists the Twisted Bow as a unique', () => {
    const raids = findCategory('raids')
    const cox = raids?.sections.find((s: any) => s.id === 'chambers_of_xeric')
    expect(cox).toBeTruthy()
    expect(cox.items).toContain('twisted_bow')
  })

  it('Barbarian Assault lists the Fighter Hat as a minigame unique', () => {
    const minigames = findCategory('minigames')
    const ba = minigames?.sections.find((s: any) => s.id === 'barbarian_assault')
    expect(ba).toBeTruthy()
    expect(ba.items).toContain('fighter_hat')
  })

  it('Has a clue tier with at least one entry', () => {
    const clues = findCategory('clues')
    expect(clues?.sections.length).toBeGreaterThan(0)
    expect(clues?.sections[0].items.length).toBeGreaterThan(0)
  })
})
