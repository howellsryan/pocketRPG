import { describe, it, expect } from 'vitest'
import { createTravelTask, advanceTravel, travelFraction, travelDestName } from '../src/engine/travel.js'
import { pathLegs } from '../src/engine/world.js'

describe('createTravelTask', () => {
  it('builds a multi-leg travel task with the cheapest route', () => {
    const task = createTravelTask('lumbright', 'portsarin')!
    expect(task.type).toBe('travel')
    expect(task.from).toBe('lumbright')
    expect(task.dest).toBe('portsarin')
    expect(task.path).toEqual(['lumbright', 'draynar', 'portsarin'])
    expect(task.totalTicks).toBe(18)
    expect(task.ticksRemaining).toBe(18)
  })

  it('returns null for travelling to the place you are already at', () => {
    expect(createTravelTask('lumbright', 'lumbright')).toBeNull()
  })

  it('normalises an unknown origin to the start place', () => {
    const task = createTravelTask('atlantis', 'draynar')!
    expect(task.from).toBe('lumbright')
    expect(task.dest).toBe('draynar')
    expect(task.totalTicks).toBe(8)
  })

  it('returns null for an unreachable destination', () => {
    expect(createTravelTask('lumbright', 'atlantis')).toBeNull()
  })
})

describe('advanceTravel', () => {
  const task = createTravelTask('lumbright', 'draynar')! // 8 ticks

  it('decrements ticksRemaining by elapsed ticks (600ms each)', () => {
    const res = advanceTravel(task, 3 * 600)
    expect(res.arrived).toBe(false)
    expect(res.ticksRemaining).toBe(5)
    expect(res.task.ticksRemaining).toBe(5)
    // original task is not mutated
    expect(task.ticksRemaining).toBe(8)
  })

  it('arrives once elapsed meets or exceeds the remaining ticks', () => {
    const res = advanceTravel(task, 8 * 600)
    expect(res.arrived).toBe(true)
    expect(res.ticksRemaining).toBe(0)
  })

  it('arrives when elapsed overshoots the journey', () => {
    const res = advanceTravel(task, 999 * 600)
    expect(res.arrived).toBe(true)
    expect(res.ticksRemaining).toBe(0)
  })

  it('partial-tick elapsed does not advance', () => {
    const res = advanceTravel(task, 599)
    expect(res.arrived).toBe(false)
    expect(res.ticksRemaining).toBe(8)
  })

  it('is a no-op for non-travel tasks', () => {
    const res = advanceTravel({ type: 'combat' } as any, 10000)
    expect(res.arrived).toBe(false)
  })
})

describe('travelFraction', () => {
  it('reports progress 0..1 from ticksRemaining', () => {
    const task = createTravelTask('lumbright', 'draynar')! // 8 ticks
    expect(travelFraction(task)).toBe(0)
    expect(travelFraction({ ...task, ticksRemaining: 4 })).toBeCloseTo(0.5)
    expect(travelFraction({ ...task, ticksRemaining: 0 })).toBe(1)
  })
})

describe('travelDestName', () => {
  it('resolves the destination place name', () => {
    expect(travelDestName(createTravelTask('lumbright', 'portsarin')!)).toBe('Port Sarin')
    expect(travelDestName(null as any)).toBe('')
  })
})

describe('pathLegs', () => {
  it('splits a path into legs with their edge tick weights', () => {
    const legs = pathLegs(['lumbright', 'draynar', 'portsarin'])
    expect(legs).toEqual([
      { from: 'lumbright', to: 'draynar', ticks: 8 },
      { from: 'draynar', to: 'portsarin', ticks: 10 },
    ])
  })
  it('returns an empty array for a single-node or invalid path', () => {
    expect(pathLegs(['lumbright'])).toEqual([])
    expect(pathLegs(undefined as any)).toEqual([])
  })
})
