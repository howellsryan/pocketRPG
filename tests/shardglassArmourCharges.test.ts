import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'
import { getEquipmentBonuses, chargedScaleArmourSlots } from '../src/engine/equipment.js'
import { simulateIdleCombat } from '../src/engine/idleEngine.js'
import { applyTaskResult } from '../src/engine/applyTaskResult.js'

// Shardglass armour: scale-charged defensive gear that burns one charge per worn
// piece each time the wearer takes a hit, and stops giving bonuses at 0 charges.
const armourItems: any = {
  shardglass_body: {
    id: 'shardglass_body', slot: 'body', type: 'armour', scaleCharged: true,
    chargeItemId: 'shardglass_shards',
    attackBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 80, slash: 80, crush: 80, magic: 0, ranged: 80 },
  },
  plain_sword: {
    id: 'plain_sword', slot: 'weapon', attackStyle: 'slash', attackSpeed: 4,
    attackBonus: { stab: 0, slash: 60, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 60 },
  },
}

afterEach(() => vi.restoreAllMocks())

describe('chargedScaleArmourSlots', () => {
  it('lists worn scale-charged armour with charges, excluding weapon and depleted pieces', () => {
    const equipment: any = {
      body: { itemId: 'shardglass_body', charges: 3 },
      weapon: { itemId: 'plain_sword' },
    }
    expect(chargedScaleArmourSlots(equipment, armourItems)).toEqual(['body'])

    equipment.body.charges = 0
    expect(chargedScaleArmourSlots(equipment, armourItems)).toEqual([])
  })
})

describe('getEquipmentBonuses with depleted scale-charged armour', () => {
  it('drops the armour defence bonus once charges run dry', () => {
    const charged: any = { body: { itemId: 'shardglass_body', charges: 2 } }
    const depleted: any = { body: { itemId: 'shardglass_body', charges: 0 } }
    expect(getEquipmentBonuses(charged, armourItems).defenceBonus.stab).toBe(80)
    expect(getEquipmentBonuses(depleted, armourItems).defenceBonus.stab).toBe(0)
  })
})

describe('live combat armour charge consumption', () => {
  it('emits a consumeArmourCharge event for worn pieces when a hit lands', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const monster: any = {
      id: 'brute', name: 'Brute', hitpoints: 500, combatLevel: 99,
      attackSpeed: 4, attackStyle: 'crush',
      stats: { attack: 5000, strength: 5000, defence: 1, magic: 1, ranged: 1 },
      attackBonus: 5000, strengthBonus: 5000,
      defenceBonus: { stab: -50, slash: -50, crush: -50, magic: 0, ranged: 0 },
      noSeedDrops: true,
    }
    const state = createCombatState(monster, 'melee')
    state.monsterAttackTimer = 0
    const stats = { attack: 99, strength: 99, defence: 1, ranged: 1, magic: 1, currentHP: 99 }
    const eq = { weapon: { itemId: 'plain_sword' }, body: { itemId: 'shardglass_body', charges: 3 } }
    const { events } = processCombatTick(state, stats, eq, armourItems)
    const hit = events.find((e: any) => e.type === 'monsterHit')
    expect(hit?.damage).toBeGreaterThan(0)
    const consume = events.find((e: any) => e.type === 'consumeArmourCharge')
    expect(consume).toBeTruthy()
    expect(consume.slots).toContain('body')
    expect(consume.qty).toBe(1)
  })

  it('does not consume armour charges when the attack misses', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const monster: any = {
      id: 'weakling', name: 'Weakling', hitpoints: 500, combatLevel: 1,
      attackSpeed: 4, attackStyle: 'crush',
      stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
      attackBonus: 0, strengthBonus: 0,
      defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
      noSeedDrops: true,
    }
    const state = createCombatState(monster, 'melee')
    state.monsterAttackTimer = 0
    const stats = { attack: 99, strength: 99, defence: 99, ranged: 1, magic: 1, currentHP: 99 }
    const eq = { weapon: { itemId: 'plain_sword' }, body: { itemId: 'shardglass_body', charges: 3 } }
    const { events } = processCombatTick(state, stats, eq, armourItems)
    expect(events.some((e: any) => e.type === 'monsterMiss')).toBe(true)
    expect(events.some((e: any) => e.type === 'consumeArmourCharge')).toBe(false)
  })
})

describe('idle combat armour charge consumption', () => {
  it('reports armourChargesConsumed and applyTaskResult drains the worn piece', () => {
    const task: any = {
      stance: 'accurate',
      monster: {
        id: 'hitter', name: 'Hitter', hitpoints: 30,
        attackSpeed: 4, attackStyle: 'crush',
        stats: { attack: 200, strength: 200, defence: 1, magic: 1 },
        attackBonus: 200, strengthBonus: 200,
        defenceBonus: { crush: 0, magic: 0 },
        drops: [],
      },
    }
    const stats: any = {
      attack: { xp: 13034431 }, strength: { xp: 13034431 },
      defence: { xp: 0 }, hitpoints: { xp: 13034431 }, ranged: { xp: 0 }, magic: { xp: 0 },
    }
    const equipment: any = {
      weapon: { itemId: 'plain_sword' },
      body: { itemId: 'shardglass_body', charges: 1000 },
    }
    const sim = simulateIdleCombat(task, 600_000, stats, equipment, Array(28).fill(null), armourItems)
    expect(sim).toBeTruthy()
    expect(sim!.monstersKilled).toBeGreaterThan(0)
    expect(sim!.armourChargesConsumed?.body).toBeGreaterThan(0)

    const state: any = { stats: {}, inventory: Array(28).fill(null), bank: {}, equipment, settings: {} }
    applyTaskResult(state, sim, 'combat')
    expect(equipment.body.charges).toBe(1000 - sim!.armourChargesConsumed.body)
    expect(equipment.body.charges).toBeLessThan(1000)
  })
})
