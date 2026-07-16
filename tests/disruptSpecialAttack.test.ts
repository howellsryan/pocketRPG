import { describe, expect, it } from 'vitest'
import { applySpecialAttack, createCombatState, processCombatTick } from '../src/engine/combat.js'
import { effectiveStrength, meleeMaxHit, getMeleeStyleBonuses } from '../src/engine/formulas.js'
import itemsDataJson from '../src/data/items.json'

const itemsData: any = itemsDataJson
const equipment: any = { weapon: { itemId: 'zul_kaars_blade' } }
const playerStats: any = { attack: 99, strength: 99, defence: 99, hitpoints: 99, ranged: 99, magic: 99 }

function makeMonster(defence: number, hp = 1000, extra: any = {}) {
  return {
    id: 'dummy',
    name: 'Dummy',
    hitpoints: hp,
    stats: { attack: 1, strength: 1, defence, magic: 1, ranged: 1 },
    attackBonus: 0,
    strengthBonus: 0,
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    drops: [],
    ...extra,
  }
}

function setupState(defence: number, extra: any = {}) {
  return createCombatState(makeMonster(defence, 1000, extra), 'melee', 'aggressive')
}

function withRng<T>(value: number, fn: () => T): T {
  const orig = Math.random
  Math.random = () => value
  try { return fn() } finally { Math.random = orig }
}

// Expected max melee hit for the fixed playerStats/aggressive/zul_kaars_blade
// combo, derived from the same formulas combat.js uses (no magic numbers).
const styleBonuses = getMeleeStyleBonuses('aggressive')
const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
const expectedMaxMelee = meleeMaxHit(effStr, itemsData.zul_kaars_blade.otherBonus.meleeStrength)

describe("Zul-Kaar's Blade Disrupt special attack", () => {
  it('item is registered with a percent-only special (no flat energyCost field)', () => {
    const spec = itemsData.zul_kaars_blade.specialAttack
    expect(spec.type).toBe('disrupt')
    expect(spec.energyCostPercent).toBe(50)
    expect(spec.energyCost).toBeUndefined()
  })

  it('hits regardless of monster defence — no accuracy roll at all', () => {
    const lowDef = withRng(0.5, () => {
      const { events } = applySpecialAttack(setupState(1), playerStats, equipment, itemsData)
      return (events.find((e: any) => e.type === 'specialHit') as any).totalDamage
    })
    const highDef = withRng(0.5, () => {
      const { events } = applySpecialAttack(setupState(999), playerStats, equipment, itemsData)
      return (events.find((e: any) => e.type === 'specialHit') as any).totalDamage
    })
    expect(lowDef).toBe(highDef)
    expect(lowDef).toBeGreaterThan(0)
  })

  it('damage is floor(maxMelee * rand(0.5, 1.5)) — bounded and matches the formula exactly', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
      const damage = withRng(r, () => {
        const { events } = applySpecialAttack(setupState(50), playerStats, equipment, itemsData)
        return (events.find((e: any) => e.type === 'specialHit') as any).hits[0]
      })
      expect(damage).toBe(Math.floor(expectedMaxMelee * (0.5 + r)))
      expect(damage).toBeGreaterThanOrEqual(Math.floor(expectedMaxMelee * 0.5))
      expect(damage).toBeLessThan(expectedMaxMelee * 1.5)
    }
  })

  it('grants exactly 2 Magic XP per point of actual damage dealt (no HP XP)', () => {
    withRng(0.4, () => {
      const { combatState, events } = applySpecialAttack(setupState(50), playerStats, equipment, itemsData)
      const specHit: any = events.find((e: any) => e.type === 'specialHit')
      expect(combatState.xpGained.magic).toBe(2 * specHit.totalDamage)
      expect(combatState.xpGained.hitpoints).toBeUndefined()
    })
  })

  it('deals zero damage and XP, and emits an immuneHit event, against a magic-immune monster', () => {
    withRng(0.999, () => {
      const state = setupState(50, { magicImmune: true })
      const { combatState, events } = applySpecialAttack(state, playerStats, equipment, itemsData)
      expect(combatState.monster.currentHP).toBe(1000)
      expect(combatState.xpGained.magic).toBeUndefined()
      const immuneEvent: any = events.find((e: any) => e.type === 'immuneHit')
      expect(immuneEvent).toBeTruthy()
      expect(immuneEvent.immunity).toBe('magic')
      expect(events.find((e: any) => e.type === 'specialHit')).toBeUndefined()
    })
  })

  it('processCombatTick scales special-attack damage with active prayer/potion strength boosts, matching the normal-attack path', () => {
    // Regression: applySpecialAttack used to be called with the raw, unboosted
    // playerStats inside processCombatTick, so every special attack (not just
    // Disrupt) ignored active prayers/potions entirely — only gear bonuses
    // applied. Fixed to pass the same boostedPlayerStats the normal attack uses.
    const prayersData = { test_str_prayer: { bonusType: 'stat', stat: 'strength', boostPercent: 20 } }
    const boostedStrength = Math.floor(playerStats.strength * 1.2)
    const boostedEffStr = effectiveStrength(boostedStrength, 0, 1.0, styleBonuses.strengthStyleBonus)
    const boostedMaxMelee = meleeMaxHit(boostedEffStr, itemsData.zul_kaars_blade.otherBonus.meleeStrength)
    expect(boostedMaxMelee).toBeGreaterThan(expectedMaxMelee)

    const state: any = { ...createCombatState(makeMonster(50, 1000), 'melee', 'aggressive'), specialAttackQueued: true, playerAttackTimer: 0, activeCombatPrayer: 'test_str_prayer' }
    const damage = withRng(0, () => {
      const result = processCombatTick(state, playerStats, equipment, itemsData, prayersData)
      const specHit: any = result.events.find((e: any) => e.type === 'specialHit')
      return specHit.hits[0]
    })
    expect(damage).toBe(Math.floor(boostedMaxMelee * 0.5))
  })

  it('processCombatTick drains exactly 50% of current energy (percent-of-current, not flat)', () => {
    let state: any = { ...createCombatState(makeMonster(50, 1000), 'melee', 'aggressive'), specialAttackQueued: true, playerAttackTimer: 0 }
    withRng(0.4, () => {
      const result = processCombatTick(state, playerStats, equipment, itemsData)
      state = result.combatState
    })
    expect(state.specialAttackEnergy).toBe(50) // ceil(100 * 50/100) = 50, 100-50=50

    // Second use spends 50% of the now-lower pool (25), not another flat 50.
    state.specialAttackQueued = true
    state.playerAttackTimer = 0
    withRng(0.4, () => {
      const result = processCombatTick(state, playerStats, equipment, itemsData)
      state = result.combatState
    })
    expect(state.specialAttackEnergy).toBe(25)
  })
})
