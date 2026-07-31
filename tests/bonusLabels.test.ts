import { describe, it, expect } from 'vitest'
// @ts-ignore
import { OTHER_BONUS_LABELS, OTHER_BONUS_PERCENT_KEYS } from '../src/utils/bonusLabels.js'
// @ts-ignore
import itemsData from '../src/data/items.json'

function otherBonusKeys(): string[] {
  const keys = new Set<string>()
  for (const item of Object.values(itemsData as Record<string, any>)) {
    if (!item?.otherBonus) continue
    for (const k of Object.keys(item.otherBonus)) keys.add(k)
  }
  return [...keys].sort()
}

describe('other-bonus labels', () => {
  it('labels every otherBonus key any item actually wears', () => {
    const unlabelled = otherBonusKeys().filter(k => !OTHER_BONUS_LABELS[k])
    expect(unlabelled).toEqual([])
  })

  it('renders the three damage multipliers as percentages', () => {
    for (const k of ['magicDamage', 'meleeDamage', 'rangedDamage']) {
      expect(OTHER_BONUS_PERCENT_KEYS.has(k)).toBe(true)
      expect(OTHER_BONUS_LABELS[k]).toMatch(/%$/)
    }
  })
})
