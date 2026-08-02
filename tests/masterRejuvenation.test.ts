// Master Rejuvenation (Construction Lv 90) used to snap the special bar back to
// 100% every time it emptied, which made specials free in any long fight. It now
// recharges energy on the clock at twice the open world's rate — and since a
// solo/co-op fight has no clock regen of its own (§7), that doubled rate is the
// only regen PvE gets. One number everywhere: 20 energy per 30 seconds.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  BASE_SPECIAL_REGEN_PER_TICK,
  MASTER_REJUVENATION_MULTIPLIER,
  SPECIAL_ENERGY_MAX,
  hasMasterRejuvenation,
  accrueSpecialEnergy,
  regenSpecialEnergy,
  specialRegenPerTick,
} from '../src/engine/specialRegen.js'
import { UNLOCKABLES } from '../src/engine/construction.js'
import {
  addCoopMember,
  createCoopBossState,
  createCoopMember,
  processCoopTick,
} from '../src/engine/coopBossEngine.js'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'
import prayersData from '../src/data/prayers.json'
import spellsData from '../src/data/spells.json'

const deps = { itemsData, monstersData, prayersData, spellsData }
const BOSS = 'corporeal_horror'
/** 30 seconds of 600ms ticks — the interval both rates are quoted over. */
const TICKS_PER_30S = 50

afterEach(() => { vi.restoreAllMocks() })

function savePayload(unlocked: string[] | undefined) {
  return {
    stats: {
      attack: { xp: 1_000_000 }, strength: { xp: 1_000_000 }, defence: { xp: 1_000_000 },
      hitpoints: { xp: 1_000_000 }, ranged: { xp: 1_000_000 }, magic: { xp: 1_000_000 },
      prayer: { xp: 1_000_000 },
    },
    equipment: { weapon: { itemId: 'krylth_spear', quantity: 1 } },
    inventory: [null, null, null],
    settings: unlocked ? { unlockedFeatures: unlocked } : {},
  }
}

function joined(unlocked: string[] | undefined, characterId = 1) {
  const state = createCoopBossState(BOSS, monstersData)!
  return addCoopMember(state, createCoopMember({
    characterId, username: 'p1', savePayload: savePayload(unlocked), itemsData,
  }))
}

describe('special-energy regen rates', () => {
  it('does nothing in PvE without the perk — a fight still only refills on a kill', () => {
    expect(specialRegenPerTick(false)).toBe(0)
    expect(regenSpecialEnergy(0, specialRegenPerTick(false))).toBe(0)
  })

  it('is exactly twice the open world rate, in the world and in PvE alike', () => {
    const world = specialRegenPerTick(true, BASE_SPECIAL_REGEN_PER_TICK)
    const pve = specialRegenPerTick(true)
    expect(world).toBe(BASE_SPECIAL_REGEN_PER_TICK * MASTER_REJUVENATION_MULTIPLIER)
    expect(pve).toBe(world)
    expect(pve * TICKS_PER_30S).toBe(20)
  })

  it('leaves the base world rate alone for a player without the perk', () => {
    expect(specialRegenPerTick(false, BASE_SPECIAL_REGEN_PER_TICK)).toBe(BASE_SPECIAL_REGEN_PER_TICK)
    expect(BASE_SPECIAL_REGEN_PER_TICK * TICKS_PER_30S).toBe(10)
  })

  it('trickles up from empty instead of snapping to full', () => {
    let energy = 0
    const perTick = specialRegenPerTick(true)
    for (let i = 0; i < TICKS_PER_30S; i++) energy = regenSpecialEnergy(energy, perTick)
    expect(energy).toBeCloseTo(20, 6)
    expect(energy).not.toBe(SPECIAL_ENERGY_MAX)
  })

  it('clamps at the cap and never exceeds it', () => {
    expect(regenSpecialEnergy(99.9, specialRegenPerTick(true))).toBe(SPECIAL_ENERGY_MAX)
    expect(regenSpecialEnergy(SPECIAL_ENERGY_MAX, specialRegenPerTick(true))).toBe(SPECIAL_ENERGY_MAX)
  })

  it('reads the unlock from either shape the save takes', () => {
    expect(hasMasterRejuvenation(new Set(['master_rejuvenation']))).toBe(true)
    expect(hasMasterRejuvenation(['money_purse', 'master_rejuvenation'])).toBe(true)
    expect(hasMasterRejuvenation(['money_purse'])).toBe(false)
    expect(hasMasterRejuvenation(undefined)).toBe(false)
  })

  it('describes the perk as a recharge, not a refill', () => {
    const perk = UNLOCKABLES.find((u: any) => u.id === 'master_rejuvenation')!
    expect(perk.description).toMatch(/twice as fast/i)
    expect(perk.description).not.toMatch(/refill/i)
  })
})

describe('co-op rooms carry the perk', () => {
  it('stamps the flag on the member from the join snapshot', () => {
    expect(createCoopMember({
      characterId: 1, username: 'p1', savePayload: savePayload(['master_rejuvenation']), itemsData,
    }).masterRejuvenation).toBe(true)
    expect(createCoopMember({
      characterId: 2, username: 'p2', savePayload: savePayload(undefined), itemsData,
    }).masterRejuvenation).toBe(false)
  })

  it('regenerates a member’s energy during the fight, in whole points', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let state = joined(['master_rejuvenation'])
    state.members['1'].combat.specialAttackEnergy = 0
    for (let i = 0; i < 10; i++) state = processCoopTick(state, [], deps, Date.now()).stateNext
    // 10 ticks * 0.4 = 4. The room projects this value to every client every
    // tick and skips the frame when nothing moved, so it must never be
    // fractional — that would change on every single tick.
    expect(state.members['1'].combat.specialAttackEnergy).toBe(4)
    expect(Number.isInteger(state.members['1'].combat.specialAttackEnergy)).toBe(true)
  })

  it('leaves a member without the perk on the per-fight model', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let state = joined(undefined)
    state.members['1'].combat.specialAttackEnergy = 0
    for (let i = 0; i < 10; i++) state = processCoopTick(state, [], deps, Date.now()).stateNext
    expect(state.members['1'].combat.specialAttackEnergy).toBe(0)
  })

  it('keeps regenerating through the respawn wait and the raid lobby — both are prep time', () => {
    let state = joined(['master_rejuvenation'])
    state.members['1'].combat.specialAttackEnergy = 0
    state.boss.respawnCountdown = 20
    for (let i = 0; i < 5; i++) state = processCoopTick(state, [], deps, Date.now()).stateNext
    expect(state.members['1'].combat.specialAttackEnergy).toBe(2)

    state.phase = 'lobby'
    for (let i = 0; i < 5; i++) state = processCoopTick(state, [], deps, Date.now()).stateNext
    expect(state.members['1'].combat.specialAttackEnergy).toBe(4)
  })

  it('carries the fraction beside the value, never on it', () => {
    const first = accrueSpecialEnergy(0, 0, specialRegenPerTick(true))
    expect(first).toEqual({ energy: 0, carry: 0.4 })
    const second = accrueSpecialEnergy(first.energy, first.carry, specialRegenPerTick(true))
    expect(second.energy).toBe(0)
    const third = accrueSpecialEnergy(second.energy, second.carry, specialRegenPerTick(true))
    expect(third.energy).toBe(1)
    expect(accrueSpecialEnergy(100, 0.9, specialRegenPerTick(true))).toEqual({ energy: 100, carry: 0 })
  })
})
