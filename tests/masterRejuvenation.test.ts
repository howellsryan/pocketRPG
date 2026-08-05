// Master Rejuvenation (Construction Lv 90) snaps the special bar back to 100%
// the moment it empties. One rule shared by every context that owns a copy of
// the energy — a solo fight, a co-op/raid member, an open-world session — and
// switched off in exactly one place, the Wilderness (covered by
// world/tests/specialEnergyRegen.test.ts, which owns the world's clock).
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  SPECIAL_ENERGY_MAX,
  hasMasterRejuvenation,
  refillSpecialOnEmpty,
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

describe('the Master Rejuvenation refill', () => {
  it('fills a spent bar to the cap', () => {
    expect(refillSpecialOnEmpty(0, true)).toBe(SPECIAL_ENERGY_MAX)
  })

  it('does nothing without the perk — a spent bar stays spent', () => {
    expect(refillSpecialOnEmpty(0, false)).toBe(0)
  })

  it('only fires at empty, never topping a part-spent bar up', () => {
    expect(refillSpecialOnEmpty(35, true)).toBe(35)
    expect(refillSpecialOnEmpty(SPECIAL_ENERGY_MAX, true)).toBe(SPECIAL_ENERGY_MAX)
  })

  it('reads the unlock from either shape the save takes', () => {
    expect(hasMasterRejuvenation(new Set(['master_rejuvenation']))).toBe(true)
    expect(hasMasterRejuvenation(['money_purse', 'master_rejuvenation'])).toBe(true)
    expect(hasMasterRejuvenation(['money_purse'])).toBe(false)
    expect(hasMasterRejuvenation(undefined)).toBe(false)
  })

  it('describes the perk as a refill', () => {
    const perk = UNLOCKABLES.find((u: any) => u.id === 'master_rejuvenation')!
    expect(perk.description).toMatch(/refills/i)
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

  it('refills a member’s bar the tick after it empties', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let state = joined(['master_rejuvenation'])
    state.members['1'].combat.specialAttackEnergy = 0
    state = processCoopTick(state, [], deps, Date.now()).stateNext
    expect(state.members['1'].combat.specialAttackEnergy).toBe(SPECIAL_ENERGY_MAX)
  })

  it('leaves a member without the perk on the per-fight model', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let state = joined(undefined)
    state.members['1'].combat.specialAttackEnergy = 0
    for (let i = 0; i < 10; i++) state = processCoopTick(state, [], deps, Date.now()).stateNext
    expect(state.members['1'].combat.specialAttackEnergy).toBe(0)
  })

  it('refills through the respawn wait and the raid lobby — both are prep time', () => {
    let state = joined(['master_rejuvenation'])
    state.members['1'].combat.specialAttackEnergy = 0
    state.boss.respawnCountdown = 20
    state = processCoopTick(state, [], deps, Date.now()).stateNext
    expect(state.members['1'].combat.specialAttackEnergy).toBe(SPECIAL_ENERGY_MAX)

    state.phase = 'lobby'
    state.members['1'].combat.specialAttackEnergy = 0
    state = processCoopTick(state, [], deps, Date.now()).stateNext
    expect(state.members['1'].combat.specialAttackEnergy).toBe(SPECIAL_ENERGY_MAX)
  })
})
