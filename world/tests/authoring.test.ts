import { describe, expect, it } from 'vitest'
import { compileRegion, deriveContract } from '../authoring/compiler.mjs'
import world from '../../src/data/world.json'
import activities from '../../src/data/worldActivities.json'

const context = () => ({
  world: { places: { test: { facilities: ['bank'] } } },
  activities: { test: [{ kind: 'skill', ref: 'mining:clay' }, { kind: 'gather', ref: 'cache' }, { kind: 'combat', ref: 'rat' }] },
  skills: { mining: { actions: [{ id: 'clay', product: 'clay', level: 1 }] } },
  gatherTasks: [{ id: 'cache', product: 'thread', ticks: 6 }],
  monsters: { rat: { name: 'Rat' } },
  assets: { props: { house: { min: [-1,0,-1], max: [1,2,1], baseScale: 1 } }, monsters: ['rat'], ambient: ['villager'] },
  prefabs: {}
})
const source = () => ({
  schemaVersion: 1, id: 'test', name: 'Test village', place: 'test', seed: 42,
  width: 20, height: 20, spawn: { x: 10, z: 10 },
  points: [{ id: 'arrival', x: 10, z: 10 }, { id: 'bank', x: 10, z: 5 }],
  routes: [{ id: 'main', from: 'arrival', to: 'bank', width: 3, kind: 'path_cobble' }],
  surfaces: [], lots: [], dressing: [], groves: [],
  resources: [{ id: 'clay', ref: 'skill:mining:clay', x: 5, z: 10 }, { id: 'cache', ref: 'gather:cache', x: 6, z: 10 }, { id: 'bank', ref: 'facility:bank', x: 10, z: 5 }],
  encounters: [{ id: 'rats', ref: 'combat:rat', wander: { x: 2, z: 2, w: 3, h: 3 }, spawns: [{ x: 3, z: 3 }] }],
  ambient: { critters: [], smoke: [] },
  budgets: { props: 100, npcs: 10, ambient: 10, maxPropsPer8x8: 30 },
  reviewViews: [{ id: 'arrival', target: 'arrival', mode: 'gameplay' }]
})

describe('semantic world compiler', () => {
  it('binds spatial identities from owning data rather than inventing regional content', () => {
    const { zone, report } = compileRegion(source(), context())
    expect(zone.objects.find((o: any) => o.id === 'clay')).toMatchObject({ type: 'rock', rock: 'clay' })
    expect(zone.objects.find((o: any) => o.id === 'cache')).toMatchObject({ type: 'gather_site', gather: 'cache' })
    expect(zone.npcs[0]).toMatchObject({ monsterId: 'rat' })
    expect(report.parity).toEqual({ missing: [], unexpected: [] })
  })
  it('derives Lumbright membership directly from current idle activities and facilities', () => {
    const c = deriveContract('lumbright', { ...context(), world, activities })
    const owner = activities.lumbright.filter((a) => a.kind === 'combat').map((a) => 'combat:' + a.ref)
    expect(c.monsters).toEqual(owner)
    expect(c.facilities).toEqual(world.places.lumbright.facilities.map((f) => 'facility:' + f))
  })
  it('rejects missing and unexpected canonical content', () => {
    const s = source(); s.resources.splice(0, 1)
    expect(() => compileRegion(s, context())).toThrow(/missing.*skill:mining:clay/i)
    const extra = source(); extra.resources.push({ id: 'tin', ref: 'skill:mining:tin', x: 8, z: 8 })
    expect(() => compileRegion(extra, context())).toThrow(/unexpected|unsupported/)
  })
  it('reserves roads before buildings and refuses to cut collision through a mesh', () => {
    const s = source(); s.dressing.push({ model: 'house', x: 10, z: 7 } as never)
    expect(() => compileRegion(s, context())).toThrow(/route.*overlap|overlap.*route/i)
  })
  it('checks the entire wander area and a usable approach to each resource', () => {
    const s = source(); s.surfaces.push({ kind: 'water', x: 2, z: 2, w: 1, h: 1, blocked: true } as never)
    expect(() => compileRegion(s, context())).toThrow(/wander.*blocked/i)
    const trapped = source(); trapped.surfaces.push({ kind: 'water', x: 4, z: 9, w: 3, h: 3, blocked: true } as never)
    expect(() => compileRegion(trapped, context())).toThrow(/clay.*blocked|clay.*unreachable/i)
  })
  it('rejects unrenderable species and missing scenery assets', () => {
    const c = context(); c.assets.monsters = []
    expect(() => compileRegion(source(), c)).toThrow(/rat.*visual|visual.*rat/i)
    const s = source(); s.dressing.push({ model: 'missing', x: 14, z: 14 } as never)
    expect(() => compileRegion(s, context())).toThrow(/missing.*asset|asset.*missing/i)
  })
  it('stamps all prefab layers with namespaced identities and quarter-turn transforms', () => {
    const c = context()
    c.prefabs = { cottage: {
      props: [{ model: 'house', x: 0, z: 0 }],
      ground: [{ kind: 'floor_stone', x: -1, z: -1, w: 2, h: 2 }],
      blocked: [{ x: 3, z: 0, w: 1, h: 1 }],
      points: [{ id: 'door', x: 0, z: 3 }],
      ambient: { critters: [{ model: 'villager', x: -2, z: 2, w: 2, h: 2, count: 1 }], smoke: [{ x: 0, z: 0, y: 2 }] }
    } } as any
    const s = source(); s.lots.push({ id: 'home', prefab: 'cottage', x: 15, z: 14, turns: 1 } as never)
    const { zone, report } = compileRegion(s, c)
    expect(zone.collision[11][15]).toBe('#')
    expect(report.points.find((p: any) => p.id === 'home:door')).toMatchObject({ x: 18, z: 14 })
    expect(zone.ambient.smoke[0]).toMatchObject({ x: 15, z: 14, y: 2 })
    expect(zone.ambient.critters[0]).toMatchObject({ x: 17, z: 15, w: 2, h: 2 })
    expect(zone.ground.some((g: any) => g.kind === 'floor_stone')).toBe(true)
  })
  it('is deterministic, does not mutate sources, and enforces scenery budgets', () => {
    const s = source(), before = JSON.stringify(s)
    s.groves.push({ id: 'edge', x: 12, z: 12, w: 7, h: 7, count: 6, models: ['house'], scaleRange: [0.2,0.3] } as never)
    expect(compileRegion(s, context())).toEqual(compileRegion(s, context()))
    s.groves = []; expect(JSON.stringify(s)).toBe(before)
    s.budgets.props = 0; s.dressing.push({ model: 'house', x: 15, z: 15 } as never)
    expect(() => compileRegion(s, context())).toThrow(/budget/i)
  })
})
