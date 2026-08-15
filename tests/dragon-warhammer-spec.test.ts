import { describe, expect, it } from 'vitest'
import { applySpecialAttack, createCombatState } from '../src/engine/combat.js'

const itemsData = {
  dragon_warhammer: {
    id: 'dragon_warhammer',
    type: 'weapon',
    slot: 'weapon',
    attackStyle: 'crush',
    attackSpeed: 6,
    attackBonus: { stab: 0, slash: 0, crush: 95, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 85, rangedStrength: 0, magicDamage: 0 },
    specialAttack: { type: 'smash', energyCost: 50 }
  }
}

function makeMonster(defence: number, hp = 1000) {
  return {
    id: 'dummy',
    name: 'Dummy',
    hitpoints: hp,
    stats: { attack: 1, strength: 1, defence, magic: 1, ranged: 1 },
    attackBonus: 0,
    strengthBonus: 0,
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    drops: []
  }
}

function setupState(defence: number) {
  return createCombatState(makeMonster(defence), 'melee', 'aggressive')
}

const playerStats: any = { attack: 99, strength: 99, defence: 99, hitpoints: 99, ranged: 99, magic: 99 }
const equipment: any = { weapon: { itemId: 'dragon_warhammer' } }

function withRng<T>(seq: number[], fn: () => T): T {
  const orig = Math.random
  let i = 0
  Math.random = () => seq[i++ % seq.length]
  try { return fn() } finally { Math.random = orig }
}

describe('Dragon Warhammer smash special attack', () => {
  it('reduces target Defence by floor(30%) of its current level on a hit and stacks across uses', () => {
    let state: any = setupState(75)
    withRng([0, 0.5], () => {
      const r1 = applySpecialAttack(state, playerStats, equipment, itemsData)
      state = r1.combatState
      expect(state.monster.stats.defence).toBe(53) // 75 - floor(75 * 0.3) = 53

      const r2 = applySpecialAttack(state, playerStats, equipment, itemsData)
      state = r2.combatState
      expect(state.monster.stats.defence).toBe(38) // 53 - floor(53 * 0.3) = 38

      const r3 = applySpecialAttack(state, playerStats, equipment, itemsData)
      state = r3.combatState
      expect(state.monster.stats.defence).toBe(27) // 38 - floor(38 * 0.3) = 27
    })
  })

  it('stamps baseDefenceLevel at fight start and never moves it, so the info panel can show what Defence was', () => {
    // Smash mutates stats.defence in place with no running total of its own
    // (unlike a defence-BONUS drain, which bossForms.js tracks in
    // defenceBonusDrain) — baseDefenceLevel is the fight-start snapshot the UI
    // diffs the live value against.
    let state: any = setupState(75)
    expect(state.monster.baseDefenceLevel).toBe(75)
    withRng([0, 0.5], () => {
      const r1 = applySpecialAttack(state, playerStats, equipment, itemsData)
      state = r1.combatState
      expect(state.monster.stats.defence).toBe(53)
      expect(state.monster.baseDefenceLevel).toBe(75)

      const r2 = applySpecialAttack(state, playerStats, equipment, itemsData)
      state = r2.combatState
      expect(state.monster.stats.defence).toBe(38)
      expect(state.monster.baseDefenceLevel).toBe(75)
    })
  })

  it('emits a specialHit event with specType "smash" and a defenceReducedBy field', () => {
    const state = setupState(100)
    withRng([0, 0.5], () => {
      const { events } = applySpecialAttack(state, playerStats, equipment, itemsData)
      const specHit: any = events.find((e: any) => e.type === 'specialHit')
      expect(specHit).toBeTruthy()
      expect(specHit.specType).toBe('smash')
      expect(specHit.defenceReducedBy).toBe(30) // floor(100 * 0.3)
      expect(specHit.totalDamage).toBeGreaterThan(0)
    })
  })

  it('does not reduce Defence on a miss', () => {
    const state: any = setupState(75)
    // Force Math.random > accuracy → miss; rollDamage returns 0.
    withRng([0.999999], () => {
      const { combatState, events } = applySpecialAttack(state, playerStats, equipment, itemsData)
      expect(combatState.monster.stats.defence).toBe(75)
      const specHit: any = events.find((e: any) => e.type === 'specialHit')
      expect(specHit.totalDamage).toBe(0)
      expect(specHit.defenceReducedBy).toBe(0)
    })
  })

  it('applies the 1.5x max-hit multiplier (deals more than the regular max)', () => {
    // Without spec, melee max hit at 99 str / aggressive / +85 melee strength = 26.
    // With 1.5x it caps at floor(26 * 1.5) = 39. Force near-max damage roll.
    const state: any = setupState(1)
    let observed = 0
    withRng([0, 0.9999], () => {
      const { events } = applySpecialAttack(state, playerStats, equipment, itemsData)
      const specHit: any = events.find((e: any) => e.type === 'specialHit')
      observed = specHit.hits[0]
    })
    expect(observed).toBeGreaterThan(26) // proves the 1.5x multiplier was applied
    expect(observed).toBeLessThanOrEqual(39)
  })

  it('declares a 50% energy cost on the dragon_warhammer item', () => {
    expect(itemsData.dragon_warhammer.specialAttack.energyCost).toBe(50)
  })
})
