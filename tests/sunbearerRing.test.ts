// Sunbearer Ring: special-attack energy never drains while worn (PvE only).
// The effect was previously undocumented/unimplemented (docs/tomb-of-arasmus-
// implementation.md marked it DEFERRED) — this proves the pin behaviour and
// that it doesn't change anything when the ring isn't equipped.
import { describe, expect, it } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'
import itemsDataJson from '../src/data/items.json'

const itemsData: any = itemsDataJson
const playerStats: any = { attack: 99, strength: 99, defence: 99, hitpoints: 99, ranged: 99, magic: 99 }

function makeMonster(defence: number, hp = 1000) {
  return {
    id: 'dummy',
    name: 'Dummy',
    hitpoints: hp,
    stats: { attack: 1, strength: 1, defence, magic: 1, ranged: 1 },
    attackBonus: 0,
    strengthBonus: 0,
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    drops: [],
  }
}

function withRng<T>(value: number, fn: () => T): T {
  const orig = Math.random
  Math.random = () => value
  try { return fn() } finally { Math.random = orig }
}

function fireSpecial(equipment: any, items: any = itemsData) {
  const state: any = { ...createCombatState(makeMonster(50, 1000), 'melee', 'aggressive'), specialAttackQueued: true, playerAttackTimer: 0 }
  return withRng(0.4, () => processCombatTick(state, playerStats, equipment, items).combatState)
}

describe('Sunbearer Ring — special energy pin', () => {
  it('without the ring, a flat-cost special still drains energy as before', () => {
    const state = fireSpecial({ weapon: { itemId: 'zul_kaars_blade' } })
    expect(state.specialAttackEnergy).toBe(50)
  })

  it('with the ring equipped, a flat-cost special leaves energy at 100', () => {
    const state = fireSpecial({ weapon: { itemId: 'zul_kaars_blade' }, ring: { itemId: 'sunbearer_ring' } })
    expect(state.specialAttackEnergy).toBe(100)
  })

  it('with the ring equipped, specials can fire back-to-back with no cooldown on energy', () => {
    let equipment: any = { weapon: { itemId: 'zul_kaars_blade' }, ring: { itemId: 'sunbearer_ring' } }
    let state: any = { ...createCombatState(makeMonster(50, 100000), 'melee', 'aggressive'), specialAttackQueued: true, playerAttackTimer: 0 }
    for (let i = 0; i < 5; i++) {
      state = withRng(0.4, () => processCombatTick(state, playerStats, equipment, itemsData).combatState)
      expect(state.specialAttackEnergy).toBe(100)
      state.specialAttackQueued = true
      state.playerAttackTimer = 0
    }
  })

  it('with the ring equipped, a percent-cost special also stays at 100', () => {
    const itemsWithPercentSpec = {
      ...itemsData,
      test_percent_spec_weapon: {
        ...itemsData.zul_kaars_blade,
        id: 'test_percent_spec_weapon',
        specialAttack: { ...itemsData.zul_kaars_blade.specialAttack, energyCost: undefined, energyCostPercent: 50 },
      },
    }
    const state = fireSpecial(
      { weapon: { itemId: 'test_percent_spec_weapon' }, ring: { itemId: 'sunbearer_ring' } },
      itemsWithPercentSpec
    )
    expect(state.specialAttackEnergy).toBe(100)
  })

  it('a ring in a different slot (not the ring slot) has no effect', () => {
    const state = fireSpecial({ weapon: { itemId: 'zul_kaars_blade' }, cape: { itemId: 'sunbearer_ring' } })
    expect(state.specialAttackEnergy).toBe(50)
  })
})
