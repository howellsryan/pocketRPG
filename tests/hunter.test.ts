import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHunterState, processHunterTick, simulateIdleHunting } from '../src/engine/hunter.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const action = {
  name: 'Bird Snare',
  ticks: 3,
  xp: 34,
  rewardTables: [
    {
      rewards: [
        { itemId: 'feather', chance: 0.5, quantity: 1 },
        { itemId: 'bone', chance: 0.5, quantity: [2, 4] },
      ],
    },
    {
      rarity: 4,
      rewards: [{ itemId: 'rare_claw', chance: 1, quantity: 1 }],
    },
  ],
}

describe('hunter engine', () => {
  it('creates hunter state', () => {
    expect(createHunterState(action as any)).toEqual({
      active: true,
      action,
      ticksRemaining: 3,
      tickCount: 0,
      justCompleted: false,
    })
  })

  it('processes active tick lifecycle and completion reset', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    let state = createHunterState(action as any)

    let out = processHunterTick(state)
    expect(out.events).toEqual([])
    expect(out.hunterState.ticksRemaining).toBe(2)

    out = processHunterTick(out.hunterState)
    expect(out.events).toEqual([])

    out = processHunterTick(out.hunterState)
    expect(out.events).toHaveLength(1)
    expect(out.events[0]).toMatchObject({ type: 'hunterSuccess', xp: 34, actionName: 'Bird Snare' })
    expect(out.hunterState.justCompleted).toBe(true)

    const afterReset = processHunterTick(out.hunterState)
    expect(afterReset.hunterState.justCompleted).toBe(false)
    expect(afterReset.hunterState.ticksRemaining).toBe(3)
  })

  it('rolls main and rare rewards deterministically', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.2) // main first bucket
      .mockReturnValueOnce(0.9) // rare fail
      .mockReturnValueOnce(0.8) // main second bucket
      .mockReturnValueOnce(0.4) // quantity roll => 3
      .mockReturnValueOnce(0.1) // rare pass
      .mockReturnValueOnce(0.3) // rare table pick

    const first = processHunterTick({ ...createHunterState(action as any), ticksRemaining: 1 })
    expect(first.events[0].rewards).toEqual([{ itemId: 'feather', quantity: 1 }])

    const second = processHunterTick({ ...createHunterState(action as any), ticksRemaining: 1 })
    expect(second.events[0].rewards).toEqual([
      { itemId: 'bone', quantity: 3 },
      { itemId: 'rare_claw', quantity: 1 },
    ])
  })

  it('simulates idle hunting with floored actions and aggregated rewards', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.2)
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.8)
      .mockReturnValueOnce(0.0)
      .mockReturnValueOnce(0.9)

    expect(simulateIdleHunting(null as any, 1000)).toBeNull()
    expect(simulateIdleHunting({ action } as any, 1000)).toBeNull()

    const sim = simulateIdleHunting({ action } as any, 3600)
    expect(sim).toMatchObject({
      xpGained: { hunter: 68 },
      actions: 2,
      skill: 'hunter',
      actionName: 'Bird Snare',
    })
    expect(sim?.rewards).toEqual([
      { itemId: 'feather', quantity: 1 },
      { itemId: 'bone', quantity: 2 },
    ])
  })
})
