import { describe, it, expect } from 'vitest'
import monstersData from '../src/data/monsters.json'

describe('skeletal wyvern drops', () => {
  it('drops exactly dragon bones as its only bone drop', () => {
    const wyvern = (monstersData as any).skeletal_wyvern
    expect(wyvern).toBeDefined()
    const boneDrops = wyvern.drops.filter((d: any) => d.itemId.includes('bones'))
    expect(boneDrops).toHaveLength(1)
    expect(boneDrops[0]).toMatchObject({ itemId: 'dragon_bones', quantity: 1, chance: 1 })
  })
})
