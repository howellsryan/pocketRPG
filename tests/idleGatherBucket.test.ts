import { describe, expect, it } from 'vitest'
import { simulateIdleGather } from '../src/engine/idleEngine.js'

describe('idle gather bucket requirement', () => {
  it('requires bucket but does not consume it', () => {
    const result = simulateIdleGather(
      { type: 'gather', gatherTask: { id: 'collect_sand', ticks: 3, product: 'bucket_of_sand', qty: 1, requiresItem: 'bucket', reusableRequirement: true } },
      9_000,
      Array(28).fill(null),
      {},
      { bucket_of_sand: { id: 'bucket_of_sand', stackable: false } },
      { bucket: { itemId: 'bucket', quantity: 1 } },
    )
    expect(result?.actions).toBeGreaterThan(0)
    expect(result?.itemsConsumed?.bucket).toBeUndefined()
  })

  it('blocks sand gathering without bucket', () => {
    const result = simulateIdleGather(
      { type: 'gather', gatherTask: { id: 'collect_sand', ticks: 3, product: 'bucket_of_sand', qty: 1, requiresItem: 'bucket', reusableRequirement: true } },
      9_000,
      Array(28).fill(null),
      {},
      { bucket_of_sand: { id: 'bucket_of_sand', stackable: false } },
      {},
    )
    expect(result).toBeNull()
  })
})
