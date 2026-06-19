import { describe, expect, it } from 'vitest'
import { createThievingState, processThievingTick, simulateIdleThieving } from '../src/engine/thieving.js'

const npc = { name: 'Man', xp: 8, coins: 3, drops: [{ itemId: 'bread', chance: 1 }] }

describe('thieving engine', () => {
  it('creates thieving state', () => {
    expect(createThievingState(npc as any)).toEqual({
      active: true,
      npc,
      ticksRemaining: 4,
      tickCount: 0,
      justCompleted: false,
    })
  })

  it('processes tick lifecycle and emits success event on fourth tick', () => {
    let out = processThievingTick(createThievingState(npc as any))
    expect(out.events).toEqual([])
    out = processThievingTick(out.thievingState)
    expect(out.events).toEqual([])
    out = processThievingTick(out.thievingState)
    expect(out.events).toEqual([])
    out = processThievingTick(out.thievingState)

    expect(out.events).toHaveLength(1)
    expect(out.events[0]).toEqual({
      type: 'pickpocketSuccess',
      xp: 8,
      coins: 3,
      npcName: 'Man',
      drops: [{ itemId: 'bread', chance: 1 }],
    })
    expect(out.thievingState.justCompleted).toBe(true)

    const reset = processThievingTick(out.thievingState)
    expect(reset.thievingState.justCompleted).toBe(false)
    expect(reset.thievingState.ticksRemaining).toBe(4)
  })

  it('defaults missing event coins and drops', () => {
    const poorNpc = { name: 'Farmer', xp: 14 }
    const out = processThievingTick({ ...createThievingState(poorNpc as any), ticksRemaining: 1 })
    expect(out.events[0]).toMatchObject({ coins: 0, drops: [] })
  })

  it('simulates idle thieving with floored actions and no partial rewards', () => {
    expect(simulateIdleThieving(null as any, 2400)).toBeNull()
    expect(simulateIdleThieving({ npc } as any, 2399)).toBeNull()

    const sim = simulateIdleThieving({ npc } as any, 5000)
    expect(sim).toEqual({
      xpGained: { thieving: 16 },
      coinsGained: 6,
      actions: 2,
      skill: 'thieving',
      actionName: 'Man',
    })

    const noCoins = simulateIdleThieving({ npc: { name: 'A', xp: 5 } } as any, 2400)
    expect(noCoins?.coinsGained).toBe(0)
  })

  it('rewards Master Farmer seeds (one per pickpocket) instead of coins, at 2x duration', () => {
    const farmer = { name: 'Master Farmer', xp: 43, coins: 0, seedReward: true, pickpocketTicks: 8 }
    // 8 ticks/action → 4800ms per pickpocket. 5000ms is still only one action.
    const one = simulateIdleThieving({ npc: farmer } as any, 5000) as any
    expect(one.actions).toBe(1)
    expect(one.coinsGained).toBe(0)
    expect(Object.values(one.itemsGained).reduce((a: number, b: any) => a + b, 0)).toBe(1)

    // Twice as long as a normal NPC: 8 ticks vs 4 over the same window.
    const sim = simulateIdleThieving({ npc: farmer } as any, 10_000) as any
    expect(sim.actions).toBe(2)

    // createThievingState reflects the slower cadence.
    expect(createThievingState(farmer as any).ticksRemaining).toBe(8)
  })
})
