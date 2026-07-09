import { describe, expect, it } from 'vitest'
import { validateZone, type ZoneDef } from '../shared/zone'
import pastureZone from '../zones/pasture.json'

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
