import { describe, it, expect } from 'vitest'
import { createTravelTask, advanceTravel, travelFraction, travelDestName, travelCancelLocation, travelLeftoverMs, formatTravelTicks } from '../src/engine/travel.js'
import { pathLegs } from '../src/engine/world.js'

describe('createTravelTask', () => {
  it('builds a multi-leg travel task with the cheapest route', () => {
    const task = createTravelTask('lumbright', 'portsarin')!
    expect(task.type).toBe('travel')
    expect(task.from).toBe('lumbright')
    expect(task.dest).toBe('portsarin')
    expect(task.path).toEqual(['lumbright', 'draynar', 'portsarin'])
    expect(task.totalTicks).toBe(90)
    expect(task.ticksRemaining).toBe(90)
  })

  it('returns null for travelling to the place you are already at', () => {
    expect(createTravelTask('lumbright', 'lumbright')).toBeNull()
  })

  it('normalises an unknown origin to the start place', () => {
    const task = createTravelTask('atlantis', 'draynar')!
    expect(task.from).toBe('lumbright')
    expect(task.dest).toBe('draynar')
    expect(task.totalTicks).toBe(40)
  })

  it('returns null for an unreachable destination', () => {
    expect(createTravelTask('lumbright', 'atlantis')).toBeNull()
  })

  it('embeds an autoStart descriptor when given one, and omits it otherwise', () => {
    const plain = createTravelTask('lumbright', 'draynar')!
    expect('autoStart' in plain).toBe(false)
    const withStart = createTravelTask('lumbright', 'draynar', { kind: 'combat', monsterId: 'cow' })!
    expect(withStart.autoStart).toEqual({ kind: 'combat', monsterId: 'cow' })
  })
})

describe('advanceTravel', () => {
  const task = createTravelTask('lumbright', 'draynar')! // 40 ticks

  it('decrements ticksRemaining by elapsed ticks (600ms each)', () => {
    const res = advanceTravel(task, 3 * 600)
    expect(res.arrived).toBe(false)
    expect(res.ticksRemaining).toBe(37)
    expect(res.task.ticksRemaining).toBe(37)
    // original task is not mutated
    expect(task.ticksRemaining).toBe(40)
  })

  it('arrives once elapsed meets or exceeds the remaining ticks', () => {
    const res = advanceTravel(task, 40 * 600)
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
    expect(res.ticksRemaining).toBe(40)
  })

  it('is a no-op for non-travel tasks', () => {
    const res = advanceTravel({ type: 'combat' } as any, 10000)
    expect(res.arrived).toBe(false)
  })
})

describe('travelLeftoverMs', () => {
  const task = createTravelTask('lumbright', 'draynar')! // 40 ticks = 24000ms

  it('is zero when the trip did not finish within the elapsed window', () => {
    expect(travelLeftoverMs(task, 10 * 600)).toBe(0)
    expect(travelLeftoverMs(task, 40 * 600)).toBe(0)
  })

  it('returns the time left over after arrival to spend on the autoStart activity', () => {
    // Away for 100 ticks, trip cost 40 → 60 ticks of fighting after arrival.
    expect(travelLeftoverMs(task, 100 * 600)).toBe(60 * 600)
  })

  it('measures from ticksRemaining, so a half-done trip leaves more over', () => {
    expect(travelLeftoverMs({ ...task, ticksRemaining: 10 }, 100 * 600)).toBe(90 * 600)
  })

  it('is zero for non-travel or missing tasks', () => {
    expect(travelLeftoverMs({ type: 'combat' } as any, 100000)).toBe(0)
    expect(travelLeftoverMs(null as any, 100000)).toBe(0)
  })
})

describe('travelFraction', () => {
  it('reports progress 0..1 from ticksRemaining', () => {
    const task = createTravelTask('lumbright', 'draynar')! // 40 ticks
    expect(travelFraction(task)).toBe(0)
    expect(travelFraction({ ...task, ticksRemaining: 20 })).toBeCloseTo(0.5)
    expect(travelFraction({ ...task, ticksRemaining: 0 })).toBe(1)
  })
})

describe('travelCancelLocation', () => {
  // lumbright → draynar (40t) → portsarin (50t), 90 ticks total
  const task = createTravelTask('lumbright', 'portsarin')!

  it('returns the origin before the first leg completes', () => {
    expect(travelCancelLocation(task)).toBe('lumbright')
    expect(travelCancelLocation({ ...task, ticksRemaining: 55 })).toBe('lumbright') // 35 done
  })

  it('snaps to the last node fully reached, never forward', () => {
    expect(travelCancelLocation({ ...task, ticksRemaining: 50 })).toBe('draynar') // 40 done, leg 1 complete
    expect(travelCancelLocation({ ...task, ticksRemaining: 5 })).toBe('draynar') // 85 done, mid leg 2
  })

  it('returns the destination when the journey is complete', () => {
    expect(travelCancelLocation({ ...task, ticksRemaining: 0 })).toBe('portsarin')
  })

  it('is null for non-travel tasks', () => {
    expect(travelCancelLocation({ type: 'combat' } as any)).toBeNull()
    expect(travelCancelLocation(null as any)).toBeNull()
  })
})

describe('travelDestName', () => {
  it('resolves the destination place name', () => {
    expect(travelDestName(createTravelTask('lumbright', 'portsarin')!)).toBe('Port Sarin')
    expect(travelDestName(null as any)).toBe('')
  })
})

describe('formatTravelTicks', () => {
  it('renders sub-minute durations as whole seconds', () => {
    expect(formatTravelTicks(0)).toBe('0s')
    expect(formatTravelTicks(1)).toBe('1s') // 0.6s rounds to 1s
    expect(formatTravelTicks(99)).toBe('59s') // 59.4s rounds to 59s
  })

  it('renders exact minutes with no leftover seconds', () => {
    expect(formatTravelTicks(100)).toBe('1m') // 60s exactly
    expect(formatTravelTicks(200)).toBe('2m') // 120s exactly
  })

  it('renders minutes with a leftover-seconds remainder', () => {
    expect(formatTravelTicks(140)).toBe('1m 24s') // 84s
  })

  it('rounds to the nearest whole second before formatting', () => {
    expect(formatTravelTicks(1.4)).toBe('1s') // 0.84s rounds to 1s
  })
})

describe('pathLegs', () => {
  it('splits a path into legs with their edge tick weights', () => {
    const legs = pathLegs(['lumbright', 'draynar', 'portsarin'])
    expect(legs).toEqual([
      { from: 'lumbright', to: 'draynar', ticks: 40 },
      { from: 'draynar', to: 'portsarin', ticks: 50 },
    ])
  })
  it('returns an empty array for a single-node or invalid path', () => {
    expect(pathLegs(['lumbright'])).toEqual([])
    expect(pathLegs(undefined as any)).toEqual([])
  })
})
