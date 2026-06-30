import { describe, it, expect } from 'vitest'
import { createTravelTask, advanceTravel, travelFraction, travelDestName } from '../src/engine/travel.js'
import { pathLegs } from '../src/engine/world.js'

describe('createTravelTask', () => {
  it('builds a multi-leg travel task with the cheapest route', () => {
    const task = createTravelTask('emberhold', 'crowfoot')!
    expect(task.type).toBe('travel')
    expect(task.from).toBe('emberhold')
    expect(task.dest).toBe('crowfoot')
    expect(task.path).toEqual(['emberhold', 'oakhollow', 'crowfoot'])
    expect(task.totalTicks).toBe(30)
    expect(task.ticksRemaining).toBe(30)
  })

  it('returns null for travelling to the place you are already at', () => {
    expect(createTravelTask('emberhold', 'emberhold')).toBeNull()
  })

  it('normalises an unknown origin to the start place', () => {
    const task = createTravelTask('atlantis', 'mudgate')!
    expect(task.from).toBe('emberhold')
    expect(task.dest).toBe('mudgate')
    expect(task.totalTicks).toBe(14)
  })

  it('returns null for an unreachable destination', () => {
    expect(createTravelTask('emberhold', 'atlantis')).toBeNull()
  })
})

describe('advanceTravel', () => {
  const task = createTravelTask('emberhold', 'mudgate')! // 14 ticks

  it('decrements ticksRemaining by elapsed ticks (600ms each)', () => {
    const res = advanceTravel(task, 5 * 600)
    expect(res.arrived).toBe(false)
    expect(res.ticksRemaining).toBe(9)
    expect(res.task.ticksRemaining).toBe(9)
    // original task is not mutated
    expect(task.ticksRemaining).toBe(14)
  })

  it('arrives once elapsed meets or exceeds the remaining ticks', () => {
    const res = advanceTravel(task, 14 * 600)
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
    expect(res.ticksRemaining).toBe(14)
  })

  it('is a no-op for non-travel tasks', () => {
    const res = advanceTravel({ type: 'combat' } as any, 10000)
    expect(res.arrived).toBe(false)
  })
})

describe('travelFraction', () => {
  it('reports progress 0..1 from ticksRemaining', () => {
    const task = createTravelTask('emberhold', 'mudgate')! // 14 ticks
    expect(travelFraction(task)).toBe(0)
    expect(travelFraction({ ...task, ticksRemaining: 7 })).toBeCloseTo(0.5)
    expect(travelFraction({ ...task, ticksRemaining: 0 })).toBe(1)
  })
})

describe('travelDestName', () => {
  it('resolves the destination place name', () => {
    expect(travelDestName(createTravelTask('emberhold', 'crowfoot')!)).toBe('Crowfoot')
    expect(travelDestName(null as any)).toBe('')
  })
})

describe('pathLegs', () => {
  it('splits a path into legs with their edge tick weights', () => {
    const legs = pathLegs(['emberhold', 'oakhollow', 'crowfoot'])
    expect(legs).toEqual([
      { from: 'emberhold', to: 'oakhollow', ticks: 16 },
      { from: 'oakhollow', to: 'crowfoot', ticks: 14 },
    ])
  })
  it('returns an empty array for a single-node or invalid path', () => {
    expect(pathLegs(['emberhold'])).toEqual([])
    expect(pathLegs(undefined as any)).toEqual([])
  })
})
