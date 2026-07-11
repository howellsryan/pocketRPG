import { describe, expect, it } from 'vitest'
import { validateExitGraph, validateZone, type ZoneDef } from '../shared/zone'
import pastureZone from '../zones/pasture.json'
import forestZone from '../zones/forest.json'
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
})

describe('Phase 6 zones', () => {
  it('accepts the real forest zone', () => {
    expect(validateZone(forestZone as ZoneDef)).toEqual({ valid: true })
  })

  it('validates the pasture↔forest exit graph', () => {
    const zones = { pasture: pastureZone as ZoneDef, forest: forestZone as ZoneDef }
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
