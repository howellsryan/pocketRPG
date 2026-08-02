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
  shardglass_halberd: {
    id: 'shardglass_halberd', slot: 'weapon', attackStyle: 'slash', attackSpeed: 7,
    scaleCharged: true, chargeItemId: 'shardglass_shards',
    attackBonus: { stab: 150, slash: 150, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 200 },
    specialAttack: { type: 'triple_hit', energyCost: 30 },
  },
  venom_blowpipe: {
    id: 'venom_blowpipe', slot: 'weapon', attackStyle: 'ranged', attackSpeed: 3,
    scaleCharged: true, chargeItemId: 'venomcoil_scales',
    attackBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 60 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { rangedStrength: 40 },
    specialAttack: { type: 'toxic_siphon', energyCost: 50 },
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

// The Shardglass Halberd pays a charge for its Shardstorm exactly as it does
// for an ordinary swing — the first scale-charged melee weapon with a special.
describe('scale-charged melee special attacks', () => {
  const queueSpec = (itemId: string, charges: number, combatType = 'melee') => {
    const state: any = createCombatState(monster, combatType)
    state.specialAttackQueued = true
    state.specialAttackEnergy = 100
    const eq = { weapon: { itemId, charges } }
    return processCombatTick(state, stats, eq, itemsData)
  }

  it('spends exactly one charge when the special fires', () => {
    const { events } = queueSpec('shardglass_halberd', 5)
    const consumes = events.filter((e: any) => e.type === 'consumeCharge')
    expect(consumes).toHaveLength(1)
    expect(consumes[0].qty).toBe(1)
    expect(events.some((e: any) => e.type === 'specialHit')).toBe(true)
  })

  it('refuses to fire the special with zero charges, without draining energy', () => {
    const { combatState, events } = queueSpec('shardglass_halberd', 0)
    expect(events.some((e: any) => e.type === 'noCharges')).toBe(true)
    expect(events.some((e: any) => e.type === 'specialHit')).toBe(false)
    expect(combatState.specialAttackEnergy).toBe(100)
    expect(combatState.specialAttackQueued).toBe(false)
  })

  it('leaves the blowpipe special on its own single inline charge, never two', () => {
    const { events } = queueSpec('venom_blowpipe', 5, 'ranged')
    expect(events.filter((e: any) => e.type === 'consumeCharge')).toHaveLength(1)
  })
})
