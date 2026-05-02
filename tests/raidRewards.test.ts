import { describe, expect, it } from 'vitest'
import raidsData from '../src/data/raids.json'
import itemsData from '../src/data/items.json'

describe('raid rewards', () => {
  it('includes zaryte vambraces at elder maul weight', () => {
    const cox = (raidsData as any).chambers_of_xeric
    const elder = cox.rewards.unique.items.find((i: any) => i.itemId === 'elder_maul')
    const zaryte = cox.rewards.unique.items.find((i: any) => i.itemId === 'zaryte_vambraces')
    expect(zaryte.weight).toBe(elder.weight)
    expect((itemsData as any).zaryte_vambraces.isBossUnique).toBe(true)
  })
})
