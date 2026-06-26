import { afterEach, describe, expect, it, vi } from 'vitest'
import { rollGatherBonusDrops, BIRD_NEST_ITEM_ID, BIRD_NEST_DROP_CHANCE } from '../src/engine/skilling.js'
import { simulateIdleSkilling } from '../src/engine/idleEngine.js'

describe('rollGatherBonusDrops', () => {
  it('awards an empty bird\'s nest when the woodcutting roll lands under the drop chance', () => {
    const drops = rollGatherBonusDrops('woodcutting', () => 0)
    expect(drops).toEqual({ [BIRD_NEST_ITEM_ID]: 1 })
  })

  it('awards nothing when the roll exceeds the drop chance', () => {
    const drops = rollGatherBonusDrops('woodcutting', () => 0.9)
    expect(drops).toEqual({})
  })

  it('uses a 1/256 drop chance', () => {
    expect(BIRD_NEST_DROP_CHANCE).toBeCloseTo(1 / 256)
    // Just under the threshold drops; exactly at/above does not.
    expect(rollGatherBonusDrops('woodcutting', () => BIRD_NEST_DROP_CHANCE - 1e-9)).toEqual({ [BIRD_NEST_ITEM_ID]: 1 })
    expect(rollGatherBonusDrops('woodcutting', () => BIRD_NEST_DROP_CHANCE)).toEqual({})
  })

  it('only applies to woodcutting, not other gathering skills', () => {
    expect(rollGatherBonusDrops('mining', () => 0)).toEqual({})
    expect(rollGatherBonusDrops('fishing', () => 0)).toEqual({})
  })
})

describe('idle woodcutting bird\'s nest drops', () => {
  afterEach(() => vi.restoreAllMocks())

  it('grants a nest alongside logs when the roll lands', () => {
    // Force every bonus roll to land.
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const sim = simulateIdleSkilling(
      {
        skill: 'woodcutting',
        action: { id: 'normal', name: 'Chop tree', level: 1, ticks: 4, xp: 25, product: 'logs' },
      } as any,
      60_000,
      {} as any,
      {} as any,
      { woodcutting: { xp: 0 } } as any,
      { logs: { stackable: false }, [BIRD_NEST_ITEM_ID]: { stackable: true } } as any,
      Array(28).fill(null),
    )

    expect(sim).toBeTruthy()
    expect(sim!.itemsGained[BIRD_NEST_ITEM_ID]).toBeGreaterThan(0)
    expect(sim!.itemsGained.logs).toBeGreaterThan(0)
  })
})
