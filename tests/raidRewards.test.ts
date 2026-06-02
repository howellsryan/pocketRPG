import { describe, expect, it } from 'vitest'
import raidsData from '../src/data/raids.json'
import itemsData from '../src/data/items.json'

describe('raid rewards', () => {
  it('includes zaryte vambraces at elder maul weight', () => {
    const cox = (raidsData as any).vaults_of_xyren
    const elder = cox.rewards.unique.items.find((i: any) => i.itemId === 'ancient_maul')
    const zaryte = cox.rewards.unique.items.find((i: any) => i.itemId === 'zaryth_vambraces')
    expect(zaryte.weight).toBe(elder.weight)
    expect((itemsData as any).zaryth_vambraces.isBossUnique).toBe(true)
  })

  it('vaults_of_xyren never drops dragon_bones', () => {
    const cox = (raidsData as any).vaults_of_xyren
    const allDrops = [
      ...(cox.rewards.always ?? []),
      ...(cox.rewards.unique?.items ?? []),
    ]
    expect(allDrops.some((d: any) => d.itemId === 'dragon_bones')).toBe(false)
  })
})
