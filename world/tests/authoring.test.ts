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
  reviewViews: [{ id: 'overview', target: 'arrival', mode: 'overview' }, { id: 'arrival', target: 'arrival', mode: 'gameplay', covers: ['skill:mining:clay','gather:cache','facility:bank','combat:rat'] }]
})

describe('semantic world compiler', () => {
  it('binds spatial identities from owning data rather than inventing regional content', () => {
    const { zone, report } = compileRegion(source(), context())
    expect(zone.objects.find((o: any) => o.id === 'clay')).toMatchObject({ type: 'rock', rock: 'clay' })
    expect(zone.objects.find((o: any) => o.id === 'cache')).toMatchObject({ type: 'gather_site', gather: 'cache' })
    expect(zone.npcs[0]).toMatchObject({ monsterId: 'rat' })
    expect(report.parity).toMatchObject({ missing: [], unexpected: [] })
  })
  it('derives Lumbright membership directly from current idle activities and facilities', () => {
    const c = deriveContract('lumbright', { ...context(), world, activities })
    const owner = activities.lumbright.filter((a) => a.kind === 'combat').map((a) => 'combat:' + a.ref).sort()
    expect(c.monsters).toEqual(owner)
    expect(c.facilities).toEqual(world.places.lumbright.facilities.map((f) => 'facility:' + f).sort())
  })
  it('rejects missing and unexpected canonical content', () => {
    const s = source(); s.resources.splice(0, 1)
    expect(() => compileRegion(s, context())).toThrow(/missing.*skill:mining:clay/i)
    const extra = source(); extra.resources.push({ id: 'tin', ref: 'skill:mining:tin', x: 8, z: 8 })
    expect(() => compileRegion(extra, context())).toThrow(/unexpected|unsupported/)
  })
  it('surfaces deferred systems and rejects unclassified canonical additions', () => {
    const c = context()
    c.activities.test.push({ kind: 'quest', ref: 'welcome' }, { kind: 'skill', ref: 'crafting:thread' })
    expect(deriveContract('test', c)).toMatchObject({ deferred: ['quest:welcome'], portable: ['skill:crafting:thread'] })
    c.activities.test.push({ kind: 'skill', ref: 'new_spatial_skill:ore' })
    expect(() => deriveContract('test', c)).toThrow(/unclassified canonical skill/)
  })
  it('requires close review coverage for every binding and unambiguous camera identities', () => {
    const missing = source(); missing.reviewViews[1].covers = ['facility:bank']
    expect(() => compileRegion(missing, context())).toThrow(/missing close review coverage.*combat:rat/)
    const overviewOnly = source(); overviewOnly.reviewViews.splice(1)
    expect(() => compileRegion(overviewOnly, context())).toThrow(/overview and close/)
    const duplicate = source(); duplicate.reviewViews[1].id = 'overview'
    expect(() => compileRegion(duplicate, context())).toThrow(/duplicate review view/)
    const unknown = source(); unknown.reviewViews[1].mode = 'pretty'
    expect(() => compileRegion(unknown, context())).toThrow(/invalid review mode/)
  })
  it('requires every canonical travel neighbor to have a reserved, walkable boundary gateway', () => {
    const c=context(); Object.assign(c.world,{edges:[['test','neighbor',1]]})
    const s={...source(),connections:[{point:'west',to:'neighbor'}]}
    s.points.push({id:'west',x:1,z:10,role:'gateway'} as never)
    s.routes.push({id:'west_road',from:'arrival',to:'west',width:3,kind:'path_cobble'})
    expect(compileRegion(s,c).report.connections[0]).toMatchObject({to:'neighbor',outward:{x:-1,z:0}})
    const absent={...s}; delete (absent as any).connections
    expect(()=>compileRegion(absent,c)).toThrow(/connections.*required/)
    s.connections=[]
    expect(()=>compileRegion(s,c)).toThrow(/missing canonical road connections/)
    s.connections=[{point:'arrival',to:'neighbor'}]
    expect(()=>compileRegion(s,c)).toThrow(/reserved gateway/)
    s.connections=[{point:'west',to:'invented'}]
    expect(()=>compileRegion(s,c)).toThrow(/invalid.*road connection/)
  })
  it('preserves authored region exits as well as prefab exits', () => {
    const s = { ...source(), exits: [{ id: 'cave', x: 12, z: 12, toZone: 'test_cave', toX: 4, toZ: 4, label: 'Cave' }] }
    expect(compileRegion(s, context()).zone.exits).toEqual(s.exits)
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
  it('blocks thin rotated fences using their asymmetric mesh bounds', () => {
    const c=context()
    Object.assign(c.assets.props,{fence:{min:[-.5,-.05,-.5],max:[.5,.3,-.43],baseScale:1}})
    const s=source(); s.dressing.push({model:'fence',x:15,z:14,rot:Math.PI/2} as never)
    expect(compileRegion(s,c).zone.collision[14][15]).toBe('#')
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

describe('regional canonical accounting', () => {
  it('classifies canonical runecraft, raids and minigames without manufacturing outdoor actions', () => {
    const c:any=context()
    c.activities.test.push({kind:'skill',ref:'runecraft:air_rune'},{kind:'raid',ref:'vault'},{kind:'minigame',ref:'trial'})
    expect(deriveContract('test',c)).toMatchObject({portable:['skill:runecraft:air_rune'],deferred:['minigame:trial','raid:vault']})
  })
  it('records an explicitly unavailable creature without spawning a fallback', () => {
    const c:any=context(); c.assets.monsters=[]
    const s:any=source(); s.encounters=[];s.deferredBindings=[{ref:'combat:rat',reason:'missing_model'}]
    s.reviewViews[1].covers=s.reviewViews[1].covers.filter((v:string)=>v!=='combat:rat')
    const {zone,report}=compileRegion(s,c)
    expect(zone.npcs).toEqual([])
    expect(report.deferredBindings).toEqual([{ref:'combat:rat',reason:'missing_model'}])
    expect(report.parity.complete).toBe(false)
  })
  it('cannot defer supported content or use a deferral to hide an invented identity', () => {
    const s:any=source();s.deferredBindings=[{ref:'skill:mining:clay',reason:'missing_model'}]
    expect(()=>compileRegion(s,context())).toThrow(/invalid deferral|supported binding/)
    s.deferredBindings=[{ref:'combat:invented',reason:'missing_model'}]
    expect(()=>compileRegion(s,context())).toThrow(/unexpected content/)
  })
  it('keeps processing costs and probabilistic resources out of direct-yield nodes', () => {
    const c:any=context()
    c.activities.test.push({kind:'gather',ref:'convert'},{kind:'skill',ref:'mining:gems'})
    c.gatherTasks.push({id:'convert',product:'plank',ticks:1,materials:{log:1},gpCost:150})
    c.skills.mining.actions.push({id:'gems',dropTable:[{item:'ruby',chance:.2}],ticks:20})
    const s:any=source();s.deferredBindings=[{ref:'gather:convert',reason:'processing_adapter'},{ref:'skill:mining:gems',reason:'probabilistic_resource'}]
    const {zone,report}=compileRegion(s,c)
    expect(zone.objects.some((o:any)=>o.gather==='convert'||o.rock==='gems')).toBe(false)
    expect(report.deferredBindings).toHaveLength(2)
    s.resources.push({id:'free_plank',ref:'gather:convert',x:14,z:14})
    expect(()=>compileRegion(s,c)).toThrow(/deferred.*bound|unsupported gather/)
  })
  it('places the two furnace/anvil components explicitly and refuses a missing component', () => {
    const c:any=context();c.world.places.test.facilities.push('furnace_anvil')
    const s:any=source()
    s.resources.push({id:'forge',ref:'facility:furnace_anvil',x:14,z:6,components:{furnace:{x:14,z:6},anvil:{x:14,z:8}}})
    s.reviewViews[1].covers.push('facility:furnace_anvil')
    const zone=compileRegion(s,c).zone
    expect(zone.objects.find((o:any)=>o.id==='forge:furnace')).toMatchObject({type:'furnace',x:14,z:6})
    expect(zone.objects.find((o:any)=>o.id==='forge:anvil')).toMatchObject({type:'anvil',x:14,z:8})
    delete s.resources.at(-1).components.anvil
    expect(()=>compileRegion(s,c)).toThrow(/component/)
  })
  it('accounts for an existing lair through a reachable reviewed access point', () => {
    const c:any=context();c.monsters.rat.boss=true;c.instanceZones={test_lair:{collision:['...','...','...'],npcs:[{monsterId:'rat'}]}}
    const s:any=source();s.encounters=[];s.exits=[{id:'enter_lair',x:10,z:8,toZone:'test_lair',toX:1,toZ:1}];s.access=[{ref:'combat:rat',zone:'test_lair',point:'arrival',exit:'enter_lair'}]
    const {zone,report}=compileRegion(s,c)
    expect(zone.npcs).toEqual([])
    expect(report.access).toEqual([{ref:'combat:rat',zone:'test_lair',point:'arrival',exit:'enter_lair'}])
    c.instanceZones.test_lair.npcs=[]
    expect(()=>compileRegion(s,c)).toThrow(/lair.*identity|instance.*identity/)
  })
  it('refuses to move a canonical boss onto a safe-town encounter rectangle', () => {
    const c:any=context();c.monsters.rat.boss=true
    expect(()=>compileRegion(source(),c)).toThrow(/boss.*lair|boss.*instance/)
  })
})

describe('physical instance access provenance',()=>{
 it('cannot claim combat parity through a point without an actual reachable entrance',()=>{
  const c:any=context();c.monsters.rat.boss=true;c.instanceZones={test_lair:{collision:['...','...','...'],npcs:[{monsterId:'rat'}]}}
  const s:any=source();s.encounters=[];s.access=[{ref:'combat:rat',zone:'test_lair',point:'arrival',exit:'absent'}]
  expect(()=>compileRegion(s,c)).toThrow(/physical.*entrance|access.*entrance/)
 })
 it('rejects a far-away access point and a blocked instance destination',()=>{
  const c:any=context();c.monsters.rat.boss=true;c.instanceZones={test_lair:{collision:['...','.#.','...'],npcs:[{monsterId:'rat'}]}}
  const s:any=source();s.encounters=[];s.exits=[{id:'enter_lair',x:10,z:8,toZone:'test_lair',toX:1,toZ:1}];s.access=[{ref:'combat:rat',zone:'test_lair',point:'arrival',exit:'enter_lair'}]
  expect(()=>compileRegion(s,c)).toThrow(/destination/)
  c.instanceZones.test_lair.collision=['...','...','...'];s.access[0].point='bank'
  s.exits[0].z=15
  expect(()=>compileRegion(s,c)).toThrow(/access.*approach|access.*entrance/)
 })
})
