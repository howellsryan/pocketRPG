import { describe, expect, it, vi } from 'vitest'
import itemsData from '../src/data/items.json'
import { applySpecialAttack, createCombatState, processCombatTick } from '../src/engine/combat.js'
import { getEquipmentBonuses } from '../src/engine/equipment.js'
import { chargedArmourRecoil } from '../src/engine/chargedPassives.js'
import { simulateIdleCombat } from '../src/engine/idleEngine.js'

const items: any = itemsData
const stats: any = { attack: 99, strength: 99, defence: 99, hitpoints: 99, ranged: 99, magic: 99, currentHP: 99 }
const target: any = {
  id: 'target', name: 'Target', hitpoints: 5000, combatLevel: 500, attackSpeed: 99, attackStyle: 'crush', maxHit: 1,
  stats: { attack: 1, strength: 1, defence: 300, magic: 320, ranged: 1 },
  attackBonus: 0, strengthBonus: 0,
  defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: -200 },
  drops: [], noSeedDrops: true, noCharmDrops: true,
}

describe('Sunspire reward equipment data', () => {
  it('authors raid uniques and prayer armour through normal item metadata', () => {
    for (const id of [
      'sunweaver_quiver', 'twinflare_chakrams', 'resonance_crystal',
      'resonant_bulwark_boots', 'sunbound_zealot_helm',
      'sunbound_zealot_cuirass', 'sunbound_zealot_greaves',
    ]) {
      expect(items[id]?.isBossUnique || items[id]?.isRaidUnique).toBe(true)
    }
    expect(items.sunbound_zealot_helm.otherBonus.prayer).toBeGreaterThan(0)
    expect(items.sunbound_zealot_cuirass.otherBonus.prayer).toBeGreaterThan(items.sunbound_zealot_helm.otherBonus.prayer)
    expect(items.sunbound_zealot_greaves.otherBonus.prayer).toBeGreaterThan(0)
  })

  it('builds Resonant Bulwark Boots from the existing Grondar Boots progression item', () => {
    expect(items.resonance_crystal.combineWith).toBe('grondar_boots')
    expect(items.resonance_crystal.combineResult).toBe('resonant_bulwark_boots')
    const basePrayer = items.grondar_boots.otherBonus?.prayer || 0
    expect(items.resonant_bulwark_boots.otherBonus.prayer).toBe(basePrayer + 2)
    expect(items.resonant_bulwark_boots.maxCharges).toBeGreaterThanOrEqual(6000)
  })

  it('keeps the quiver in the cape slot and gains its authored bonus only while charged', () => {
    expect(items.sunweaver_quiver.slot).toBe('cape')
    expect(items.sunweaver_quiver.requirements.ranged).toBeGreaterThanOrEqual(75)
    const empty = getEquipmentBonuses({ cape: { itemId: 'sunweaver_quiver', charges: 0 } } as any, items)
    const charged = getEquipmentBonuses({ cape: { itemId: 'sunweaver_quiver', charges: 50 } } as any, items)
    expect(empty.attackBonus.ranged).toBeGreaterThanOrEqual(18)
    expect(charged.attackBonus.ranged).toBeGreaterThan(empty.attackBonus.ranged)
    expect(charged.otherBonus.rangedStrength).toBeGreaterThan(empty.otherBonus.rangedStrength)
  })
})

describe('Twinflare Chakrams', () => {
  it('uses one charge for a charged two-hit ordinary attack', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const equipment: any = { weapon: { itemId: 'twinflare_chakrams', charges: 10 } }
    const state: any = createCombatState(target, 'ranged', 'accurate')
    const out = processCombatTick(state, stats, equipment, items)
    const double = out.events.find((event: any) => event.type === 'chargedDoubleHit')
    expect(double?.hits).toHaveLength(2)
    expect(out.events.filter((event: any) => event.type === 'consumeCharge')).toEqual([{ type: 'consumeCharge', qty: 1 }])
    vi.restoreAllMocks()
  })

  it('still attacks uncharged at the reduced profile without consuming a charge', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const equipment: any = { weapon: { itemId: 'twinflare_chakrams', charges: 0 } }
    const state: any = createCombatState(target, 'ranged', 'accurate')
    const out = processCombatTick(state, stats, equipment, items)
    expect(out.events.some((event: any) => event.type === 'playerHit')).toBe(true)
    expect(out.events.some((event: any) => event.type === 'consumeCharge')).toBe(false)
    vi.restoreAllMocks()
  })

  it('Division rolls twice when charged and drains Defence by 12.5% of Magic per successful hit', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const equipment: any = { weapon: { itemId: 'twinflare_chakrams', charges: 10 } }
    const state: any = createCombatState(target, 'ranged', 'accurate')
    const before = state.monster.stats.defence
    const out = applySpecialAttack(state, stats, equipment, items)
    const hit = out.events.find((event: any) => event.type === 'specialHit')
    const perHitDrain = Math.floor(target.stats.magic * 0.125)
    expect(hit.specType).toBe('division')
    expect(hit.hits).toHaveLength(2)
    expect(hit.defenceReducedBy).toBe(perHitDrain * 2)
    expect(out.combatState.monster.stats.defence).toBe(before - perHitDrain * 2)
    expect(out.events.some((event: any) => event.type === 'consumeCharge')).toBe(true)
    vi.restoreAllMocks()
  })

  it('uses and exhausts the same double-hit charges in idle combat, then continues uncharged', () => {
    const idleStats: any = Object.fromEntries(
      ['attack','strength','defence','hitpoints','ranged','magic','prayer'].map((skill) => [skill, { xp: 13_034_431 }]),
    )
    const idleTarget: any = {
      ...target,
      id: 'idle_target',
      name: 'Idle Target',
      hitpoints: 600,
      combatLevel: 120,
      boss: false,
      attackSpeed: 99,
      stats: { ...target.stats, attack: 1, strength: 1, defence: 180 },
      drops: [],
    }
    const task: any = { monster: idleTarget, stance: 'accurate', bankingEnabled: false }
    const inventory = new Array(28).fill(null)

    const charged = simulateIdleCombat(
      task, 10 * 60 * 1000, idleStats,
      { weapon: { itemId: 'twinflare_chakrams', charges: 8 } } as any,
      inventory, items,
    ) as any
    const uncharged = simulateIdleCombat(
      task, 10 * 60 * 1000, idleStats,
      { weapon: { itemId: 'twinflare_chakrams', charges: 0 } } as any,
      inventory, items,
    ) as any

    expect(charged.chargesConsumed).toBe(8)
    expect(charged.resourceLimited).toBe(false)
    expect(charged.monstersKilled).toBeGreaterThanOrEqual(uncharged.monstersKilled)
    expect(charged.monstersKilled).toBeGreaterThan(0)
  })
})

describe('Resonant Bulwark Boots recoil', () => {
  it('recoils exactly one damage for successful melee hits while active and charged', () => {
    expect(chargedArmourRecoil(
      { boots: { itemId: 'resonant_bulwark_boots', charges: 10, active: true } } as any,
      items, 'slash', 12,
    )).toMatchObject({ damage: 1, slot: 'boots', consumeCharges: 1 })
  })

  it('does not recoil ranged/magic, misses, disabled passives or empty boots', () => {
    const active: any = { boots: { itemId: 'resonant_bulwark_boots', charges: 10, active: true } }
    expect(chargedArmourRecoil(active, items, 'ranged', 12)).toBeNull()
    expect(chargedArmourRecoil(active, items, 'magic', 12)).toBeNull()
    expect(chargedArmourRecoil(active, items, 'slash', 0)).toBeNull()
    expect(chargedArmourRecoil({ boots: { ...active.boots, active: false } } as any, items, 'slash', 12)).toBeNull()
    expect(chargedArmourRecoil({ boots: { ...active.boots, charges: 0 } } as any, items, 'slash', 12)).toBeNull()
  })
})
