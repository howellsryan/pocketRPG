import { describe, expect, it } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'

// Scale-charged melee weapons (Saeldor Warblade, shardglass tools wielded as
// weapons) must gate and consume charges per swing, matching the ranged bow.
const itemsData: any = {
  saeldor_warblade: {
    id: 'saeldor_warblade', slot: 'weapon', attackStyle: 'slash', attackSpeed: 4,
    scaleCharged: true, chargeItemId: 'shardglass_shards',
    attackBonus: { stab: 0, slash: 120, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 110 },
  },
}

const monster = {
  id: 'dummy', name: 'Dummy', hitpoints: 500, combatLevel: 1,
  attackSpeed: 99, attackStyle: 'crush',
  stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
  attackBonus: 0, strengthBonus: 0,
  defenceBonus: { stab: -50, slash: -50, crush: -50, magic: 0, ranged: 0 },
  noSeedDrops: true,
}

const stats = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, currentHP: 99 }

describe('scale-charged melee weapon charges', () => {
  it('cannot swing with zero charges', () => {
    const state = createCombatState(monster, 'melee')
    const eq = { weapon: { itemId: 'saeldor_warblade', charges: 0 } }
    const { events } = processCombatTick(state, stats, eq, itemsData)
    expect(events.some((e: any) => e.type === 'noCharges')).toBe(true)
    expect(events.some((e: any) => e.type === 'playerHit')).toBe(false)
  })

  it('consumes one charge per swing when charged', () => {
    const state = createCombatState(monster, 'melee')
    const eq = { weapon: { itemId: 'saeldor_warblade', charges: 5 } }
    const { events } = processCombatTick(state, stats, eq, itemsData)
    const consume = events.find((e: any) => e.type === 'consumeCharge')
    expect(consume).toBeTruthy()
    expect(consume.qty || 1).toBe(1)
    expect(events.some((e: any) => e.type === 'noCharges')).toBe(false)
  })
})
