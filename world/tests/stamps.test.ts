import { describe, expect, it } from 'vitest'
import { extractRegion, stampPrefab } from '../client/src/editor/stamps'
import { blankZone } from '../client/src/editor/state'
import { placeEntry } from '../client/src/editor/placement'

function seed() {
  const def = blankZone('t', 20, 20)
  placeEntry(def, { kind: 'rock', label: 'Tin', icon: '', rock: 'tin', level: 1 }, 3, 3)
  placeEntry(def, { kind: 'npc', label: 'Bull', icon: '', monsterId: 'pasture_bull', combatLevel: 8, hp: 8, hasModel: true }, 4, 4)
  placeEntry(def, { kind: 'prop', label: 'Bush', icon: '', model: 'bush' }, 5, 5)
  return def
}

describe('stamps', () => {
  it('extracts items in a region with coords relative to the corner', () => {
    const def = seed()
    const prefab = extractRegion(def, 3, 3, 6, 6, 'grove')
    expect(prefab).toBeTruthy()
    expect(prefab!.objects).toHaveLength(1)
    expect(prefab!.npcs).toHaveLength(1)
    expect(prefab!.props).toHaveLength(1)
    expect(prefab!.objects[0]).toMatchObject({ dx: 0, dz: 0 }) // rock at (3,3) → relative (0,0)
    expect(prefab!.props[0]).toMatchObject({ dx: 2, dz: 2 }) // bush at (5,5)
  })

  it('returns null for an empty region', () => {
    expect(extractRegion(seed(), 10, 10, 12, 12)).toBeNull()
  })

  it('stamps a prefab with fresh ids and offset coords', () => {
    const def = seed()
    const prefab = extractRegion(def, 3, 3, 6, 6, 'grove')!
    stampPrefab(def, prefab, 10, 10)
    // Rock count doubled, ids unique.
    const rocks = def.objects.filter((o) => o.type === 'rock')
    expect(rocks).toHaveLength(2)
    expect(new Set(def.objects.map((o) => o.id)).size).toBe(def.objects.length)
    expect(rocks.some((o) => o.x === 10 && o.z === 10)).toBe(true)
    expect(def.npcs.filter((n) => n.x === 11 && n.z === 11)).toHaveLength(1)
  })

  it('clamps a stamp that would land out of bounds', () => {
    const def = seed()
    const prefab = extractRegion(def, 3, 3, 6, 6, 'grove')!
    stampPrefab(def, prefab, 19, 19)
    for (const o of def.objects) {
      expect(o.x).toBeLessThan(def.width)
      expect(o.z).toBeLessThan(def.height)
    }
  })
})

it('preserves canonical fishing and fieldwork identities through a serialized editor stamp', () => {
  const original=blankZone('source',16,16)
  original.objects.push({id:'fish',type:'fishing_spot',fishing:'shrimps',x:2,z:3},{id:'cache',type:'gather_site',gather:'gather_bowstring',x:3,z:3})
  const prefab=JSON.parse(JSON.stringify(extractRegion(original,1,2,4,4)!))
  const target=blankZone('target',16,16)
  stampPrefab(target,prefab,5,6)
  expect(target.objects).toEqual([expect.objectContaining({type:'fishing_spot',fishing:'shrimps',x:6,z:7}),expect.objectContaining({type:'gather_site',gather:'gather_bowstring',x:7,z:7})])
})
