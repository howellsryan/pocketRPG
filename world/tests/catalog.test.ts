import { describe, expect, it } from 'vitest'
import { buildCatalog, gatherCatalog, monsterCatalog, objectCatalog, propCatalog } from '../shared/catalog'
import { deleteItem, findItemAt, genId, moveItem, placeEntry, placeExit } from '../client/src/editor/placement'
import { blankZone } from '../client/src/editor/state'

describe('catalog derivation', () => {
  it('derives gather nodes from skills.json (tin + normal tree present)', () => {
    const g = gatherCatalog()
    expect(g.entries.some((e) => e.kind === 'rock' && e.rock === 'tin')).toBe(true)
    expect(g.entries.some((e) => e.kind === 'tree' && e.tree === 'normal')).toBe(true)
  })

  it('derives monsters from monsters.json and badges modelled ones', () => {
    const m = monsterCatalog()
    const bull = m.entries.find((e) => e.kind === 'npc' && e.monsterId === 'pasture_bull')
    expect(bull).toBeTruthy()
    if (bull && bull.kind === 'npc') expect(bull.hasModel).toBe(true)
    const unmodelled = m.entries.find((e) => e.kind === 'npc' && !e.hasModel)
    expect(unmodelled).toBeTruthy()
  })

  it('includes the bank chest object and props from the passed model list', () => {
    expect(objectCatalog().entries[0]).toMatchObject({ kind: 'object', objectType: 'bank_chest' })
    const p = propCatalog(['pine_a', 'bush'])
    expect(p.entries.map((e) => (e.kind === 'prop' ? e.model : ''))).toEqual(['bush', 'pine_a'])
  })

  it('buildCatalog returns all four groups', () => {
    expect(buildCatalog([]).map((g) => g.title)).toEqual(['Gathering nodes', 'Monsters', 'Objects', 'Scenery props'])
  })
})

describe('placement helpers', () => {
  it('places each entry kind with a unique id and correct tile', () => {
    const def = blankZone('t', 10, 10)
    placeEntry(def, { kind: 'rock', label: 'Tin', icon: '', rock: 'tin', level: 1 }, 2, 3)
    placeEntry(def, { kind: 'tree', label: 'Oak', icon: '', tree: 'oak', level: 15 }, 4, 5)
    placeEntry(def, { kind: 'object', label: 'Chest', icon: '', objectType: 'bank_chest' }, 6, 7)
    placeEntry(def, { kind: 'npc', label: 'Bull', icon: '', monsterId: 'pasture_bull', combatLevel: 8, hp: 8, hasModel: true }, 8, 8)
    placeEntry(def, { kind: 'prop', label: 'Bush', icon: '', model: 'bush' }, 1, 1)
    expect(def.objects).toHaveLength(3)
    expect(def.npcs).toHaveLength(1)
    expect(def.props).toHaveLength(1)
    expect(def.objects.map((o) => o.id)).toEqual(['rock_1', 'tree_1', 'chest_1'])
    expect(def.npcs[0]).toMatchObject({ monsterId: 'pasture_bull', x: 8, z: 8 })
    expect(def.npcs[0].wander.w).toBeGreaterThan(0)
  })

  it('placeExit seeds a self-target placeholder that must be retargeted', () => {
    const def = blankZone('t', 10, 10)
    const sel = placeExit(def, 0, 5)
    expect(def.exits).toHaveLength(1)
    expect(def.exits![0]).toMatchObject({ toZone: 't', x: 0, z: 5 })
    expect(sel).toEqual({ group: 'exits', index: 0 })
  })

  it('finds the topmost item by priority and moves/deletes it', () => {
    const def = blankZone('t', 10, 10)
    placeEntry(def, { kind: 'prop', label: 'Bush', icon: '', model: 'bush' }, 5, 5)
    placeEntry(def, { kind: 'npc', label: 'Bull', icon: '', monsterId: 'pasture_bull', combatLevel: 8, hp: 8, hasModel: true }, 5, 5)
    const sel = findItemAt(def, 5, 5)
    expect(sel?.group).toBe('npcs') // npc outranks prop on the same tile
    moveItem(def, sel!, 20, 20) // clamps into bounds
    expect(def.npcs[0]).toMatchObject({ x: 9, z: 9 })
    deleteItem(def, sel!)
    expect(def.npcs).toHaveLength(0)
  })

  it('genId avoids collisions across objects/npcs/exits', () => {
    const def = blankZone('t', 10, 10)
    def.objects.push({ id: 'rock_1', type: 'rock', rock: 'tin', x: 1, z: 1 })
    expect(genId(def, 'rock')).toBe('rock_2')
  })
})
