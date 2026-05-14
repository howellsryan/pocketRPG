import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'
import { hasToolForSkill } from '../src/engine/skilling.js'

const baseStats = {
  mining: { xp: 13_034_431 },
  woodcutting: { xp: 13_034_431 },
}

describe('skilling tool unlock coverage', () => {
  it('recognizes runeforged, second-age, and shardglass pickaxes for mining', () => {
    const inventory: any = [
      { itemId: 'runeforged_pickaxe', quantity: 1 },
      { itemId: 'dragon_pickaxe', quantity: 1 },
      { itemId: 'shardglass_pickaxe', quantity: 1 },
    ]
    expect(hasToolForSkill('mining', {}, inventory, itemsData as any, baseStats as any)).toBe(true)
  })

  it('recognizes runeforged, second-age, and shardglass axes for woodcutting', () => {
    const inventory: any = [
      { itemId: 'runeforged_axe', quantity: 1 },
      { itemId: '2nd_age_axe', quantity: 1 },
      { itemId: 'shardglass_axe', quantity: 1 },
    ]
    expect(hasToolForSkill('woodcutting', {}, inventory, itemsData as any, baseStats as any)).toBe(true)
  })
})
