// Slayer task accuracy/damage bonuses (e.g. Slayer Helmet) are percentage
// multipliers, not raw points added to the roll/max hit — this locks that
// behaviour in combat.js against regressing back to flat addition.

import { describe, expect, it, vi, afterEach } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'

const itemsData: any = {
  bronze_dagger: {
    id: 'bronze_dagger', slot: 'weapon', attackStyle: 'stab', attackSpeed: 4,
    attackBonus: { stab: 100, slash: 0, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 100 },
  },
  slayer_helmet: {
    id: 'slayer_helmet', slot: 'head',
    attackBonus: { stab: 10, slash: 10, crush: 10, magic: -3, ranged: -5 },
    defenceBonus: { stab: 10, slash: 10, crush: 10, magic: -1, ranged: -1 },
    // meleeStrength kept at 0 so the test isolates the slayer-task percentage
    // bonus from the helmet's own (unrelated) strength bonus.
    otherBonus: { meleeStrength: 0, rangedStrength: 0, magicDamage: 0, slayerTaskAccuracyPercent: 15, slayerTaskDamagePercent: 15 },
  },
}

function buildMonster() {
  return {
    id: 'cave_goblin', name: 'Cave Goblin', hitpoints: 999999, combatLevel: 1, attackSpeed: 99, attackStyle: 'crush',
    stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
    attackBonus: 0, strengthBonus: 0,
    defenceBonus: { stab: -90, slash: -90, crush: -90, magic: -90, ranged: -90 },
  }
}

const maxedStats = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, currentHP: 99 }
const slayerTask = { monsterId: 'cave_goblin', monstersRemaining: 5 }

// First Math.random() call is the rollDamage hit-chance check (0 always
// hits); the second is randInt(1, maxHit)'s roll — a value just under 1
// resolves to exactly maxHit.
function forceMaxDamageRoll() {
  vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.999999999)
}

afterEach(() => {
  vi.restoreAllMocks()
})

function hitDamage(equipment: any) {
  forceMaxDamageRoll()
  const { events } = processCombatTick(createCombatState(buildMonster()), maxedStats, equipment, itemsData, {}, [], slayerTask)
  const hit = events.find(e => e.type === 'playerHit')
  expect(hit).toBeDefined()
  return hit!.damage as number
}

describe('on-task slayer damage bonus multiplies max hit instead of adding flat points', () => {
  it('a 15% slayer task damage bonus scales max hit by 1.15x, not +15', () => {
    const baseDamage = hitDamage({ weapon: { itemId: 'bronze_dagger' } })
    const bonusDamage = hitDamage({ weapon: { itemId: 'bronze_dagger' }, head: { itemId: 'slayer_helmet' } })

    expect(bonusDamage).toBe(Math.floor(baseDamage * 1.15))
    expect(bonusDamage).not.toBe(baseDamage + 15)
  })
})
