import { describe, expect, it } from 'vitest'
import itemsData from '../src/data/items.json'
import { getSlayerTaskEquipmentBonuses } from '../src/engine/slayerCombatBonuses.js'

describe('slayer task equipment bonuses', () => {
  const task = { monsterId: 'cave_goblin', monstersRemaining: 10 }
  it('stacks defender and gloves on task', () => {
    const bonuses = getSlayerTaskEquipmentBonuses({ equipment: { shield: { itemId: 'slayer_defender' }, gloves: { itemId: 'gloves_of_slaughter' } }, itemsData: itemsData as any, slayerTask: task as any, monsterId: 'cave_goblin' })
    expect(bonuses).toEqual({ accuracyFlat: 10, damageFlat: 10 })
  })

  it('applies slayer helmet through shared task bonus fields', () => {
    const bonuses = getSlayerTaskEquipmentBonuses({ equipment: { head: { itemId: 'slayer_helmet' } }, itemsData: itemsData as any, slayerTask: task as any, monsterId: 'cave_goblin' })
    expect(bonuses).toEqual({ accuracyFlat: 15, damageFlat: 15 })
  })

  it('applies raid-completion task bonuses to every boss in the raid, not just the final boss', () => {
    const raidTask = { monsterId: 'the_great_olm', monstersRemaining: 2 }
    for (const monsterId of ['tekton', 'vespula', 'muttadile', 'the_great_olm']) {
      const bonuses = getSlayerTaskEquipmentBonuses({ equipment: { head: { itemId: 'slayer_helmet' } }, itemsData: itemsData as any, slayerTask: raidTask as any, monsterId })
      expect(bonuses).toEqual({ accuracyFlat: 15, damageFlat: 15 })
    }
  })

  it('does not apply raid task bonuses to bosses from a different raid', () => {
    const raidTask = { monsterId: 'the_great_olm', monstersRemaining: 2 }
    const bonuses = getSlayerTaskEquipmentBonuses({ equipment: { head: { itemId: 'slayer_helmet' } }, itemsData: itemsData as any, slayerTask: raidTask as any, monsterId: 'sotetseg' })
    expect(bonuses).toEqual({ accuracyFlat: 0, damageFlat: 0 })
  })
})
