// Slayer task accuracy/damage bonuses (e.g. Slayer Helmet) are percentage
// multipliers, not raw points added to the roll/max hit — this locks that
// behaviour in combat.js against regressing back to flat addition.

import { describe, expect, it, vi, afterEach } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'
import { simulateIdleCombat } from '../src/engine/idleEngine.js'

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

// The idle simulator computed getSlayerTaskEquipmentBonuses and then never
// applied it, so a task idled in a slayer helm fought as if bare-headed —
// strictly worse than killing the same task by hand. These lock idle to the
// live behaviour above, and lock the on-task gate so no other fight changes.
describe('idle combat applies the same on-task slayer gear bonuses live combat does', () => {
  const idleMonster = {
    id: 'cave_goblin', name: 'Cave Goblin', hitpoints: 60, attackSpeed: 99, attackStyle: 'crush',
    stats: { attack: 1, strength: 1, defence: 80, magic: 1, ranged: 1 },
    attackBonus: 0, strengthBonus: 0,
    defenceBonus: { stab: 60, slash: 60, crush: 60, magic: 60, ranged: 60 },
    drops: [],
  }
  const idleStats: any = { attack: { xp: 13_034_431 }, strength: { xp: 13_034_431 }, defence: { xp: 0 }, hitpoints: { xp: 13_034_431 } }
  const bareKit: any = { weapon: { itemId: 'bronze_dagger' } }
  const slayerKit: any = { weapon: { itemId: 'bronze_dagger' }, head: { itemId: 'slayer_helmet' } }

  function idleKills(equipment: any, task: any) {
    const sim = simulateIdleCombat(
      { stance: 'accurate', monster: idleMonster } as any,
      600_000, idleStats, equipment, Array(28).fill(null), itemsData, task, {},
    )
    return sim!.monstersKilled
  }

  it('kills more per hour on task wearing a slayer helmet than without one', () => {
    const bare = idleKills(bareKit, { monsterId: 'cave_goblin', monstersRemaining: 500 })
    const helmed = idleKills(slayerKit, { monsterId: 'cave_goblin', monstersRemaining: 500 })
    expect(bare).toBeGreaterThan(0)
    expect(helmed).toBeGreaterThan(bare)
  })

  it('grants nothing when the fight is not the assigned slayer task', () => {
    const offTask = { monsterId: 'a_different_monster', monstersRemaining: 500 }
    expect(idleKills(slayerKit, offTask)).toBe(idleKills(bareKit, offTask))
  })

  it('grants nothing with no slayer task at all', () => {
    expect(idleKills(slayerKit, null)).toBe(idleKills(bareKit, null))
  })

  it('grants nothing once the assigned task has no kills remaining', () => {
    const finished = { monsterId: 'cave_goblin', monstersRemaining: 0 }
    expect(idleKills(slayerKit, finished)).toBe(idleKills(bareKit, finished))
  })
})
