// Locks the root-cause fix for monster damage by attack style.
//
// Previously the engine rolled every monster's max hit from stats.strength,
// regardless of attack style — so magic/ranged monsters with strength: 1
// (and raid bosses authoring an ignored top-level maxHit) capped at 1 damage.
//
// The engine now derives max hit from the offensive stat matching the attack
// style (ranged→Ranged, magic→Magic, melee→Strength), and honours an explicit
// top-level `maxHit` override. These tests pin that contract.

import { describe, expect, it, afterEach, vi } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'

const itemsData: any = {}
const equipment: any = {}

// Player can't retaliate into our single forced tick; we only measure the monster's hit.
const playerStats = { attack: 1, strength: 1, defence: 1, ranged: 1, magic: 1, currentHP: 9999 }

function expectedMaxHit(stat: number, strengthBonus = 0) {
  return Math.floor(0.5 + (stat + 8) * ((strengthBonus || 0) + 64) / 640)
}

// Force exactly one monster attack that hits for its maximum:
//   call 1 (hit check)  → 0      → guaranteed hit
//   call 2 (randInt max)→ 0.9999 → rolls the top of 1..maxHit
function forceMonsterMaxHit(monster: any): number {
  const seq = [0, 0.999999]
  let i = 0
  const spy = vi.spyOn(Math, 'random').mockImplementation(() => seq[Math.min(i++, seq.length - 1)])
  try {
    const state = createCombatState(monster, 'melee', 'defensive')
    state.playerAttackTimer = 10 // skip the player's attack this tick
    state.monsterAttackTimer = 1 // monster fires after the tick's decrement
    const { events } = processCombatTick(state, playerStats, equipment, itemsData)
    const hit = events.find((e: any) => e.type === 'monsterHit')
    return hit ? hit.damage : 0
  } finally {
    spy.mockRestore()
  }
}

function baseMonster(overrides: any = {}) {
  return {
    id: 'dummy', name: 'Dummy', boss: true, combatLevel: 100,
    hitpoints: 100, attackSpeed: 4, attackBonus: 80, strengthBonus: 0,
    stats: { attack: 1, strength: 1, defence: 50, magic: 1, ranged: 1 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    drops: [],
    ...overrides,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('monster max hit derives from the style-appropriate stat', () => {
  it('magic monster uses its Magic stat, not Strength', () => {
    const monster = baseMonster({
      attackStyle: 'magic',
      stats: { attack: 1, strength: 1, defence: 50, magic: 85, ranged: 1 },
    })
    expect(forceMonsterMaxHit(monster)).toBe(expectedMaxHit(85))
  })

  it('ranged monster uses its Ranged stat, not Strength', () => {
    const monster = baseMonster({
      attackStyle: 'ranged',
      stats: { attack: 1, strength: 1, defence: 50, magic: 1, ranged: 105 },
    })
    expect(forceMonsterMaxHit(monster)).toBe(expectedMaxHit(105))
  })

  it('melee monster still uses its Strength stat', () => {
    const monster = baseMonster({
      attackStyle: 'crush',
      stats: { attack: 80, strength: 95, defence: 50, magic: 1, ranged: 1 },
    })
    expect(forceMonsterMaxHit(monster)).toBe(expectedMaxHit(95))
  })

  it('regression: a magic monster with strength 1 no longer caps at 1 damage', () => {
    // This is the exact shape of the previously-broken roster (e.g. Astral Mage).
    const monster = baseMonster({
      attackStyle: 'magic',
      stats: { attack: 1, strength: 1, defence: 50, magic: 230, ranged: 1 },
    })
    const dmg = forceMonsterMaxHit(monster)
    expect(dmg).toBeGreaterThan(1)
    expect(dmg).toBe(expectedMaxHit(230))
  })

  it('explicit top-level maxHit overrides the stat-derived value', () => {
    // Raid bosses (Tekton, Xarpus, Maiden, Pestilent Bloat) author maxHit directly.
    const monster = baseMonster({
      attackStyle: 'ranged',
      maxHit: 50,
      stats: { attack: 1, strength: 1, defence: 50, magic: 1, ranged: 200 },
    })
    expect(forceMonsterMaxHit(monster)).toBe(50)
  })

  it('strengthBonus still scales magic/ranged max hit', () => {
    const monster = baseMonster({
      attackStyle: 'ranged',
      strengthBonus: 40,
      stats: { attack: 1, strength: 1, defence: 50, magic: 1, ranged: 100 },
    })
    expect(forceMonsterMaxHit(monster)).toBe(expectedMaxHit(100, 40))
  })
})
