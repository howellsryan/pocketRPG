import { describe, it, expect } from 'vitest'
import monstersData from '../src/data/monsters.json'

describe('skeletal wyvern drops', () => {
  it('uses dragon bones as its guaranteed bone drop', () => {
    const wyvern = monstersData.skeletal_wyvern as any
    const guaranteedBone = (wyvern?.drops || []).find((drop: any) => drop.chance === 1 && typeof drop.itemId === 'string' && drop.itemId.includes('bones'))
    expect(guaranteedBone?.itemId).toBe('dragon_bones')
  })
})
