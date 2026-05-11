import { describe, expect, it } from 'vitest'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'
import raidsData from '../src/data/raids.json'
import { formatObtainSourceMessage } from '../src/engine/itemSources.js'

describe('item source messaging', () => {
  const data = { itemsData: itemsData as any, monstersData: monstersData as any, raidsData: raidsData as any }
  it('resolves raid and monster sources', () => {
    expect(formatObtainSourceMessage('twisted_bow', data)).toContain('Vaults of Xyren')
    expect(formatObtainSourceMessage('zaryte_vambraces', data)).toContain('Vaults of Xyren')
    expect(formatObtainSourceMessage('armadyl_helmet', data)).toContain("Skyrender Kharra")
  })
})
