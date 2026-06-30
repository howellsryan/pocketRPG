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
    expect(WORLD_START_PLACE).toBe('emberhold')
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
    expect(normaliseLocation('crowfoot')).toBe('crowfoot')
  })
  it('falls back to the start place for missing/unknown locations', () => {
    expect(normaliseLocation(undefined)).toBe(WORLD_START_PLACE)
    expect(normaliseLocation(null)).toBe(WORLD_START_PLACE)
    expect(normaliseLocation('atlantis')).toBe(WORLD_START_PLACE)
  })
})

describe('shortestPath', () => {
  it('returns a zero-cost single-node path for from === to', () => {
    expect(shortestPath('emberhold', 'emberhold')).toEqual({ path: ['emberhold'], ticks: 0 })
  })

  it('uses a direct edge when it is cheapest', () => {
    const res = shortestPath('emberhold', 'mudgate')
    expect(res).toEqual({ path: ['emberhold', 'mudgate'], ticks: 14 })
  })

  it('composes a multi-leg route via the cheapest path', () => {
    // emberhold→oakhollow (16) + oakhollow→crowfoot (14) = 30, cheaper than
    // emberhold→saltmarket (22) + saltmarket→crowfoot (17) = 39.
    const res = shortestPath('emberhold', 'crowfoot')
    expect(res).toEqual({ path: ['emberhold', 'oakhollow', 'crowfoot'], ticks: 30 })
  })

  it('is symmetric (undirected graph)', () => {
    const a = shortestPath('crowfoot', 'emberhold')!
    const b = shortestPath('emberhold', 'crowfoot')!
    expect(a.ticks).toBe(b.ticks)
    expect(a.path).toEqual([...b.path].reverse())
  })

  it('returns null for unknown endpoints', () => {
    expect(shortestPath('emberhold', 'atlantis')).toBeNull()
    expect(shortestPath('atlantis', 'emberhold')).toBeNull()
  })
})
