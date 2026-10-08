// A magic weapon (e.g. a staff) with no spell selected and no built-in
// powered-staff attack used to make combat.js/idleEngine.js splash 0 damage
// every tick forever (see resolveMagicSpell's docblock), and CombatScreen.jsx
// reacted to that by kicking the player out of the fight entirely — including
// when a staff was simply equipped mid-fight with nothing selected yet.
// The fix: fall back to a plain melee attack (using the weapon's crush
// bonuses) until a spell is chosen, instead of refusing to fight.

import { describe, expect, it } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'
import { resolveMagicSpell } from '../src/engine/equipment.js'
import { mockRandomSequence } from './helpers/random'

const staffItemsData: any = {
  staff: {
    id: 'staff', slot: 'weapon', attackStyle: 'magic', attackSpeed: 4,
    // High crush, negligible magic — proves the melee roll uses the crush
    // bonus (getMeleeAttackStyle), not the weapon's raw 'magic' attackStyle.
    attackBonus: { stab: 0, slash: 0, crush: 500, magic: 1, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 500, magicDamage: 0 },
  },
}
const equipment: any = { weapon: { itemId: 'staff' } }
const maxedStats = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, currentHP: 99 }

function buildDummy(overrides: any = {}) {
  return {
    id: 'training_dummy',
    name: 'Training Dummy',
    hitpoints: 30,
    combatLevel: 1,
    attackSpeed: 99, // never gets to attack first
    attackStyle: 'crush',
    stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
    attackBonus: 0,
    strengthBonus: 0,
    // Near-unhittable by magic, wide open to crush — pins which bonus key
    // the melee-fallback roll actually used.
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 5000, ranged: 0 },
    drops: [],
    noSeedDrops: true,
    ...overrides,
  }
}

describe('resolveMagicSpell with an uncast magic weapon', () => {
  it('flags needsSpell so callers know to fall back to melee', () => {
    const r = resolveMagicSpell(equipment, staffItemsData, null, {})
    expect(r.combatType).toBe('magic')
    expect(r.needsSpell).toBe(true)
    expect(r.spell).toBeNull()
  })
})

describe('processCombatTick — melee fallback for a magic weapon with no spell', () => {
  it('deals real damage using the weapon\'s crush bonus (not its magic bonus)', () => {
    let state = createCombatState(buildDummy(), 'melee', 'accurate', null)
    let totalDamage = 0
    for (let i = 0; i < 30 && state.monster.currentHP > 0; i++) {
      const { combatState, events } = processCombatTick(state, maxedStats, equipment, staffItemsData)
      state = combatState
      for (const ev of events) if (ev.type === 'playerHit') totalDamage += ev.damage
    }
    expect(totalDamage).toBeGreaterThan(0)
  })

  it('grants melee (attack) XP, not magic XP, while falling back', () => {
    // This assertion checks XP routing after a hit, rather than hit probability.
    const random = mockRandomSequence([0.5])
    try {
      const state = createCombatState(buildDummy({ hitpoints: 1000 }), 'melee', 'accurate', null)
      const { combatState } = processCombatTick(state, maxedStats, equipment, staffItemsData)
      expect(combatState.xpGained.magic || 0).toBe(0)
      expect(combatState.xpGained.attack || 0).toBeGreaterThan(0)
    } finally {
      random.mockRestore()
    }
  })

  it('casts real magic once a spell is provided, using the same weapon', () => {
    const spell = { id: 'wind_strike', name: 'Wind Strike', baseDamage: 50, baseXP: 5 }
    let state = createCombatState(buildDummy({ hitpoints: 1000, defenceBonus: { stab: 0, slash: 0, crush: 5000, magic: 0, ranged: 0 } }), 'magic', 'accurate', spell)
    const { combatState } = processCombatTick(state, maxedStats, equipment, staffItemsData)
    state = combatState
    expect(state.xpGained.magic || 0).toBeGreaterThan(0)
  })
})
