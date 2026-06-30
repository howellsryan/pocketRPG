import { describe, it, expect } from 'vitest'
import {
  WORLD_START_PLACE,
  getWorld,
  getPlace,
  listPlaces,
  getTier,
  getKind,
  normaliseLocation,
  shortestPath,
} from '../src/engine/world.js'

describe('world model', () => {
  it('exposes a valid start place', () => {
    expect(WORLD_START_PLACE).toBe('lumbright')
    expect(getPlace(WORLD_START_PLACE)).toBeTruthy()
  })

  it('every edge references existing places', () => {
    const world = getWorld()
    for (const [a, b, t] of world.edges) {
      expect(world.places[a], `edge from ${a}`).toBeTruthy()
      expect(world.places[b], `edge to ${b}`).toBeTruthy()
      expect(typeof t).toBe('number')
      expect(t).toBeGreaterThan(0)
    }
  })

  it('every place has a known tier and its activities have known kinds + refs', () => {
    for (const p of listPlaces()) {
      expect(getTier(p.tier), `tier ${p.tier}`).toBeTruthy()
      for (const a of p.activities) {
        expect(getKind(a.kind), `kind ${a.kind}`).toBeTruthy()
        expect(typeof a.ref, `ref for ${a.kind}`).toBe('string')
      }
    }
  })

  it('getPlace / getTier / getKind return null for unknown ids', () => {
    expect(getPlace('nowhere')).toBeNull()
    expect(getTier('metropolis')).toBeNull()
    expect(getKind('podcast')).toBeNull()
  })
})

describe('normaliseLocation', () => {
  it('passes through a valid location', () => {
    expect(normaliseLocation('draynar')).toBe('draynar')
  })
  it('falls back to the start place for missing/unknown locations', () => {
    expect(normaliseLocation(undefined)).toBe(WORLD_START_PLACE)
    expect(normaliseLocation(null)).toBe(WORLD_START_PLACE)
    expect(normaliseLocation('atlantis')).toBe(WORLD_START_PLACE)
  })
})

describe('shortestPath', () => {
  it('returns a zero-cost single-node path for from === to', () => {
    expect(shortestPath('lumbright', 'lumbright')).toEqual({ path: ['lumbright'], ticks: 0 })
  })

  it('uses a direct edge when it is cheapest', () => {
    const res = shortestPath('lumbright', 'draynar')
    expect(res).toEqual({ path: ['lumbright', 'draynar'], ticks: 8 })
  })

  it('composes a multi-leg route via the cheapest path', () => {
    // lumbright→draynar (8) + draynar→portsarin (10) = 18, cheaper than routing
    // through faloden (lumbright→draynar→faloden→portsarin = 8+14+12 = 34).
    const res = shortestPath('lumbright', 'portsarin')
    expect(res).toEqual({ path: ['lumbright', 'draynar', 'portsarin'], ticks: 18 })
  })

  it('is symmetric (undirected graph)', () => {
    const a = shortestPath('portsarin', 'lumbright')!
    const b = shortestPath('lumbright', 'portsarin')!
    expect(a.ticks).toBe(b.ticks)
    expect(a.path).toEqual([...b.path].reverse())
  })

  it('returns null for unknown endpoints', () => {
    expect(shortestPath('lumbright', 'atlantis')).toBeNull()
    expect(shortestPath('atlantis', 'lumbright')).toBeNull()
  })
})
