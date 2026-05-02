import { describe, expect, it } from 'vitest'
import itemsData from '../src/data/items.json'
import { getSlayerTaskEquipmentBonuses } from '../src/engine/slayerCombatBonuses.js'

describe('slayer task equipment bonuses', () => {
  const task = { monsterId: 'goblin', monstersRemaining: 10 }
  it('stacks defender and gloves on task', () => {
    const bonuses = getSlayerTaskEquipmentBonuses({ equipment: { shield: { itemId: 'slayer_defender' }, gloves: { itemId: 'gloves_of_slaughter' } }, itemsData: itemsData as any, slayerTask: task as any, monsterId: 'goblin' })
    expect(bonuses).toEqual({ accuracyFlat: 10, damageFlat: 10 })
  })
})
