/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateExitGraph, validateZone, type ZoneDef } from '../shared/zone'
import { groundKindGrid } from '../shared/groundKinds'
import pastureZone from '../zones/pasture.json'
import forestZone from '../zones/forest.json'
import lumbrightZone from '../zones/lumbright.json'
import varrickZone from '../zones/varrick.json'
import varrickDungeonZone from '../zones/varrick_dungeon.json'
import overworldZone from '../zones/overworld.json'
import * as overworldLayout from '../scripts/overworldLayout.mjs'
import worldData from '../../src/data/world.json'

const projectPlaces = overworldLayout.projectPlaces as (places: unknown[], opts?: unknown) => { W: number; H: number; districts: { id: string; x: number; z: number }[] }
import monsters from '../../src/data/monsters.json'

describe('validateZone', () => {
  it('accepts the real pasture zone', () => {
    const result = validateZone(pastureZone as ZoneDef)
    expect(result).toEqual({ valid: true })
  })

  it('rejects a zone whose collision row count does not match height', () => {
    const zone: ZoneDef = {
      id: 'broken',
      name: 'Broken',
      width: 3,
      height: 3,
      spawn: { x: 0, z: 0 },
      collision: ['...', '...'],
      objects: [],
      npcs: [],
    }
    const result = validateZone(zone)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.some((e) => e.includes('height'))).toBe(true)
  })

  it('rejects a zone whose spawn tile is blocked', () => {
    const zone: ZoneDef = {
      id: 'broken',
      name: 'Broken',
      width: 3,
      height: 3,
      spawn: { x: 1, z: 1 },
      collision: ['...', '.#.', '...'],
      objects: [],
      npcs: [],
    }
    const result = validateZone(zone)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.some((e) => e.includes('spawn'))).toBe(true)
  })

  it('rejects a zone with an object on a blocked tile', () => {
    const zone: ZoneDef = {
      id: 'broken',
      name: 'Broken',
      width: 3,
      height: 3,
      spawn: { x: 0, z: 0 },
      collision: ['...', '.#.', '...'],
      objects: [{ id: 'rock_1', type: 'rock', rock: 'tin', x: 1, z: 1 }],
      npcs: [],
    }
    const result = validateZone(zone)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.some((e) => e.includes('rock_1'))).toBe(true)
  })

  it('rejects a zone with duplicate object/npc ids', () => {
    const zone: ZoneDef = {
      id: 'broken',
      name: 'Broken',
      width: 3,
      height: 3,
      spawn: { x: 0, z: 0 },
      collision: ['...', '...', '...'],
      objects: [{ id: 'dup', type: 'rock', rock: 'tin', x: 1, z: 1 }],
      npcs: [{ id: 'dup', monsterId: 'pasture_bull', x: 2, z: 2, wander: { x: 0, z: 0, w: 3, h: 3 } }],
    }
    const result = validateZone(zone)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true)
  })

  it('accepts a zone with valid painted ground regions', () => {
    const zone: ZoneDef = {
      id: 'ground',
      name: 'Ground',
      width: 4,
      height: 4,
      spawn: { x: 0, z: 0 },
      collision: ['....', '....', '....', '....'],
      objects: [],
      npcs: [],
      ground: [{ kind: 'path_dirt', x: 1, z: 0, w: 1, h: 4 }, { kind: 'water', x: 3, z: 3, w: 1, h: 1 }],
    }
    expect(validateZone(zone)).toEqual({ valid: true })
  })

  it('rejects a ground region with an unknown kind or one that leaves the zone', () => {
    const base: ZoneDef = {
      id: 'ground',
      name: 'Ground',
      width: 4,
      height: 4,
      spawn: { x: 0, z: 0 },
      collision: ['....', '....', '....', '....'],
      objects: [],
      npcs: [],
    }
    const badKind = validateZone({ ...base, ground: [{ kind: 'lava', x: 0, z: 0, w: 1, h: 1 }] })
    expect(badKind.valid).toBe(false)
    if (!badKind.valid) expect(badKind.errors.some((e) => e.includes('kind'))).toBe(true)
    const oob = validateZone({ ...base, ground: [{ kind: 'plaza', x: 2, z: 2, w: 5, h: 1 }] })
    expect(oob.valid).toBe(false)
    if (!oob.valid) expect(oob.errors.some((e) => e.includes('outside'))).toBe(true)
  })

  it('accepts a zone with valid ambient life (critters + smoke)', () => {
    const zone: ZoneDef = {
      id: 'ambient',
      name: 'Ambient',
      width: 8,
      height: 8,
      spawn: { x: 0, z: 0 },
      collision: ['........', '........', '........', '........', '........', '........', '........', '........'],
      objects: [],
      npcs: [],
      ambient: {
        critters: [{ model: 'chicken', x: 1, z: 1, w: 4, h: 4, count: 5 }],
        smoke: [{ x: 2, z: 3, y: 2.5 }],
      },
    }
    expect(validateZone(zone)).toEqual({ valid: true })
  })

  it('rejects ambient critters out of bounds, with a bad count, and smoke off the map', () => {
    const base: ZoneDef = {
      id: 'ambient',
      name: 'Ambient',
      width: 8,
      height: 8,
      spawn: { x: 0, z: 0 },
      collision: ['........', '........', '........', '........', '........', '........', '........', '........'],
      objects: [],
      npcs: [],
    }
    const oob = validateZone({ ...base, ambient: { critters: [{ model: 'chicken', x: 6, z: 6, w: 5, h: 5, count: 3 }] } })
    expect(oob.valid).toBe(false)
    if (!oob.valid) expect(oob.errors.some((e) => e.includes('outside'))).toBe(true)
    const badCount = validateZone({ ...base, ambient: { critters: [{ model: 'chicken', x: 0, z: 0, w: 2, h: 2, count: 99 }] } })
    expect(badCount.valid).toBe(false)
    if (!badCount.valid) expect(badCount.errors.some((e) => e.includes('count'))).toBe(true)
    const badSmoke = validateZone({ ...base, ambient: { smoke: [{ x: 9, z: 1 }] } })
    expect(badSmoke.valid).toBe(false)
    if (!badSmoke.valid) expect(badSmoke.errors.some((e) => e.includes('in-bounds'))).toBe(true)
  })
})

describe('groundKindGrid', () => {
  it('resolves regions to a per-tile grid with the last region winning on overlap', () => {
    const grid = groundKindGrid(3, 2, [
      { kind: 'path_dirt', x: 0, z: 0, w: 3, h: 1 },
      { kind: 'plaza', x: 1, z: 0, w: 1, h: 2 },
    ])
    // row 0: dirt, plaza(overlap wins), dirt ; row 1: empty, plaza, empty
    expect(grid).toEqual(['path_dirt', 'plaza', 'path_dirt', '', 'plaza', ''])
  })

  it('clamps regions to the zone bounds and ignores unknown kinds', () => {
    const grid = groundKindGrid(2, 2, [
      { kind: 'water', x: 1, z: 1, w: 5, h: 5 },
      { kind: 'nope', x: 0, z: 0, w: 2, h: 2 },
    ])
    expect(grid).toEqual(['', '', '', 'water'])
  })
})

describe('Phase 6 zones', () => {
  it('accepts the real forest zone', () => {
    expect(validateZone(forestZone as ZoneDef)).toEqual({ valid: true })
  })

  it('accepts the real lumbright zone', () => {
    expect(validateZone(lumbrightZone as ZoneDef)).toEqual({ valid: true })
  })

  it('accepts the real varrick zone', () => {
    expect(validateZone(varrickZone as unknown as ZoneDef)).toEqual({ valid: true })
  })

  it('accepts the real varrick dungeon zone', () => {
    expect(validateZone(varrickDungeonZone as unknown as ZoneDef)).toEqual({ valid: true })
  })

  it('accepts the overworld layout and gives it an aoiRadius', () => {
    const ow = overworldZone as unknown as ZoneDef
    expect(validateZone(ow)).toEqual({ valid: true })
    expect(ow.aoiRadius).toBeGreaterThan(0)
  })

  it('the overworld keeps interiors instanced — only the Varrick portal survives', () => {
    const ow = overworldZone as unknown as ZoneDef
    expect((ow.exits ?? []).map((e) => e.toZone)).toEqual(['varrick'])
  })

  it('positions every world.json place at a walkable district on the overworld', () => {
    const ow = overworldZone as unknown as ZoneDef
    const places = Object.values((worldData as { places: Record<string, { x: number; y: number }> }).places)
    const { districts } = projectPlaces(places)
    expect(districts.length).toBe(places.length)
    // The generated collision must have open ground at every place's position —
    // proving the layout in world.json and the emitted zone agree for all 14.
    for (const d of districts) {
      expect(ow.collision[d.z]?.[d.x], `district ${d.id} at (${d.x},${d.z})`).toBe('.')
    }
  })

  it('gives the overworld a travel landmark at every place, each walkable and off any exit tile', () => {
    const ow = overworldZone as unknown as ZoneDef
    const placeIds = new Set(Object.keys((worldData as { places: Record<string, unknown> }).places))
    const landmarks = ow.landmarks ?? []
    expect(landmarks.length).toBe(placeIds.size)
    const exitTiles = new Set((ow.exits ?? []).map((e) => `${e.x},${e.z}`))
    for (const lm of landmarks) {
      expect(placeIds.has(lm.id), `landmark id ${lm.id}`).toBe(true)
      expect(ow.collision[lm.z]?.[lm.x], `landmark ${lm.id} at (${lm.x},${lm.z})`).toBe('.')
      // A landmark on an exit tile would auto-warp the traveller through the
      // portal instead of landing them in the overworld beside it.
      expect(exitTiles.has(`${lm.x},${lm.z}`), `landmark ${lm.id} sits on an exit`).toBe(false)
    }
  })

  it('rejects a landmark on a blocked tile', () => {
    // (1,1) is '#'; spawn sits on the open corner so only the landmark is at fault.
    const base: ZoneDef = {
      id: 't', name: 't', width: 3, height: 3, spawn: { x: 0, z: 0 },
      collision: ['...', '.#.', '...'], objects: [], npcs: [],
    }
    expect(validateZone({ ...base, landmarks: [{ id: 'p', label: 'P', x: 0, z: 1 }] })).toEqual({ valid: true })
    const onBlock = validateZone({ ...base, landmarks: [{ id: 'p', label: 'P', x: 1, z: 1 }] })
    expect(onBlock.valid).toBe(false)
    expect(onBlock.valid === false && onBlock.errors.some((e) => e.includes('landmark'))).toBe(true)
  })

  it('the varrick dungeon boss references a real monster', () => {
    for (const npc of (varrickDungeonZone as unknown as ZoneDef).npcs) {
      expect(monsters[npc.monsterId as keyof typeof monsters], npc.monsterId).toBeTruthy()
    }
  })

  it('validates the full pasture↔forest↔lumbright↔varrick↔dungeon exit graph', () => {
    const zones = {
      pasture: pastureZone as ZoneDef,
      forest: forestZone as ZoneDef,
      lumbright: lumbrightZone as ZoneDef,
      varrick: varrickZone as unknown as ZoneDef,
      varrick_dungeon: varrickDungeonZone as unknown as ZoneDef,
    }
    expect(validateExitGraph(zones)).toEqual({ valid: true })
  })

  it('rejects an exit to an unknown zone', () => {
    const zone: ZoneDef = {
      id: 'a', name: 'A', width: 3, height: 3, spawn: { x: 0, z: 0 },
      collision: ['...', '...', '...'], objects: [], npcs: [],
      exits: [{ id: 'e', x: 2, z: 2, toZone: 'nowhere', toX: 1, toZ: 1, label: 'nowhere' }],
    }
    const result = validateExitGraph({ a: zone })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors[0]).toContain('unknown zone')
  })

  it('rejects an exit whose arrival lands on an exit tile in the target zone (ping-pong)', () => {
    const a: ZoneDef = {
      id: 'a', name: 'A', width: 3, height: 3, spawn: { x: 0, z: 0 },
      collision: ['...', '...', '...'], objects: [], npcs: [],
      exits: [{ id: 'ea', x: 2, z: 2, toZone: 'b', toX: 1, toZ: 1, label: 'B' }],
    }
    const b: ZoneDef = {
      id: 'b', name: 'B', width: 3, height: 3, spawn: { x: 0, z: 0 },
      collision: ['...', '...', '...'], objects: [], npcs: [],
      exits: [{ id: 'eb', x: 1, z: 1, toZone: 'a', toX: 0, toZ: 0, label: 'A' }],
    }
    const result = validateExitGraph({ a, b })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors[0]).toContain('lands on an exit tile')
  })

  it('the dungeon boss wings do not overlap (item 10: bosses must not drift into each other)', () => {
    const npcs = (varrickDungeonZone as unknown as ZoneDef).npcs
    const rects = npcs.map((n) => n.wander)
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        const overlaps = a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.h && b.z < a.z + a.h
        expect(overlaps, `${npcs[i].id} wander overlaps ${npcs[j].id}`).toBe(false)
      }
    }
  })

  it('the dungeon respawns a death back at Varrick, not its own spawn (item 10)', () => {
    const zone = varrickDungeonZone as unknown as ZoneDef
    expect(zone.deathRespawn).toBeTruthy()
    expect(zone.deathRespawn?.zone).toBe('varrick')
  })

  it('validates a deathRespawn targeting an unknown zone', () => {
    const zone: ZoneDef = {
      id: 'a', name: 'A', width: 3, height: 3, spawn: { x: 0, z: 0 },
      collision: ['...', '...', '...'], objects: [], npcs: [],
      deathRespawn: { zone: 'nowhere', x: 1, z: 1 },
    }
    const result = validateExitGraph({ a: zone })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors[0]).toContain('deathRespawn')
  })

  it('validates a deathRespawn landing on a blocked tile in the target zone', () => {
    const a: ZoneDef = {
      id: 'a', name: 'A', width: 3, height: 3, spawn: { x: 0, z: 0 },
      collision: ['...', '...', '...'], objects: [], npcs: [],
      deathRespawn: { zone: 'b', x: 0, z: 0 },
    }
    const b: ZoneDef = {
      id: 'b', name: 'B', width: 3, height: 3, spawn: { x: 1, z: 1 },
      collision: ['###', '###', '###'], objects: [], npcs: [],
    }
    const result = validateExitGraph({ a, b })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors[0]).toContain('not walkable')
  })

  it('validates a deathRespawn landing on the target zone\'s own exit tile (ping-pong)', () => {
    const a: ZoneDef = {
      id: 'a', name: 'A', width: 3, height: 3, spawn: { x: 0, z: 0 },
      collision: ['...', '...', '...'], objects: [], npcs: [],
      deathRespawn: { zone: 'b', x: 1, z: 1 },
    }
    const b: ZoneDef = {
      id: 'b', name: 'B', width: 3, height: 3, spawn: { x: 0, z: 0 },
      collision: ['...', '...', '...'], objects: [], npcs: [],
      exits: [{ id: 'eb', x: 1, z: 1, toZone: 'a', toX: 0, toZ: 0, label: 'A' }],
    }
    const result = validateExitGraph({ a, b })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors[0]).toContain('lands on an exit tile')
  })

  it('accepts a valid ambience block', () => {
    const zone: ZoneDef = {
      id: 'a', name: 'A', width: 3, height: 3, spawn: { x: 0, z: 0 },
      collision: ['...', '...', '...'], objects: [], npcs: [],
      ambience: { sky: '#0e1626', hemiIntensity: 0.35, sunIntensity: 1.4 },
    }
    expect(validateZone(zone)).toEqual({ valid: true })
  })

  it('rejects a malformed ambience sky colour and out-of-range intensity', () => {
    const zone: ZoneDef = {
      id: 'a', name: 'A', width: 3, height: 3, spawn: { x: 0, z: 0 },
      collision: ['...', '...', '...'], objects: [], npcs: [],
      ambience: { sky: 'blue', hemiIntensity: 99 },
    }
    const result = validateZone(zone)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes('ambience.sky'))).toBe(true)
      expect(result.errors.some((e) => e.includes('ambience.hemiIntensity'))).toBe(true)
    }
  })

  it('rejects a tree without its action id', () => {
    const zone: ZoneDef = {
      id: 'a', name: 'A', width: 3, height: 3, spawn: { x: 0, z: 0 },
      collision: ['...', '...', '...'],
      objects: [{ id: 't1', type: 'tree', x: 1, z: 1 }], npcs: [],
    }
    const result = validateZone(zone)
    expect(result.valid).toBe(false)
  })

  it('forest npcs reference real monsters', () => {
    for (const npc of (forestZone as ZoneDef).npcs) {
      expect(monsters[npc.monsterId as keyof typeof monsters], npc.monsterId).toBeTruthy()
    }
  })
})

describe('terrain-as-standard', () => {
  // Structural, not a hand-maintained list: every zone in world/zones/ must
  // ship a terrain block, so a new flat-checkerboard zone fails this test
  // rather than shipping as a visual regression.
  const zonesDir = fileURLToPath(new URL('../zones', import.meta.url))
  const zoneFiles = readdirSync(zonesDir).filter((f) => f.endsWith('.json'))

  it('found the real zone files (sanity check the directory scan itself)', () => {
    expect(zoneFiles.length).toBeGreaterThanOrEqual(5)
  })

  it.each(zoneFiles)('%s has a valid terrain block', (file) => {
    const zone = JSON.parse(readFileSync(`${zonesDir}/${file}`, 'utf8')) as ZoneDef
    expect(zone.terrain, `${file} is missing a terrain block`).toBeTruthy()
    expect(validateZone(zone)).toEqual({ valid: true })
  })
})
