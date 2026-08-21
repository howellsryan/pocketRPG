// Special attacks used to compute their accuracy and max hit from raw worn
// bonuses, skipping the on-task slayer gear multipliers and the void/set
// multipliers that every ordinary swing applies. A Slayer Helmet was worth
// +15%/+15% on a normal hit and nothing at all on the spec fired in the same
// fight. These lock the bonuses into all three styles.

import { describe, expect, it, vi, afterEach } from 'vitest'
import { createCombatState, applySpecialAttack, processCombatTick } from '../src/engine/combat.js'
import { effectiveStrength, wornMeleeMaxHit, getMeleeStyleBonuses } from '../src/engine/formulas.js'

const SLAYER_PCT = 15

const itemsData: any = {
  // Melee: 115% double hit (Dragon Dagger shape).
  test_dagger: {
    id: 'test_dagger', slot: 'weapon', attackStyle: 'stab', attackSpeed: 4,
    attackBonus: { stab: 100, slash: 0, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 100, rangedStrength: 0, magicDamage: 0 },
    specialAttack: { type: 'double_hit', energyCost: 25, description: 'Test double hit' },
  },
  // Ranged: guaranteed 150% hit, no accuracy roll by design.
  test_crossbow: {
    id: 'test_crossbow', slot: 'weapon', attackStyle: 'ranged', ammoType: 'bolt', attackSpeed: 5,
    attackBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 100 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 0, rangedStrength: 100, magicDamage: 0 },
    specialAttack: { type: 'empty_bolt', energyCost: 50, description: 'Test guaranteed bolt' },
  },
  // Magic: powered-staff surge.
  test_staff: {
    id: 'test_staff', slot: 'weapon', attackStyle: 'magic', attackSpeed: 4,
    attackBonus: { stab: 0, slash: 0, crush: 0, magic: 100, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 0, rangedStrength: 0, magicDamage: 0 },
    specialAttack: { type: 'volatile_surge', energyCost: 50, description: 'Test surge' },
  },
  slayer_helmet: {
    id: 'slayer_helmet', slot: 'head',
    attackBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    // No raw offensive bonuses, so the test isolates the slayer percentages.
    otherBonus: {
      meleeStrength: 0, rangedStrength: 0, magicDamage: 0,
      slayerTaskAccuracyPercent: SLAYER_PCT, slayerTaskDamagePercent: SLAYER_PCT,
    },
  },
}

function buildMonster() {
  return {
    id: 'cave_goblin', name: 'Cave Goblin', hitpoints: 999999, combatLevel: 1, attackSpeed: 99, attackStyle: 'crush',
    stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
    attackBonus: 0, strengthBonus: 0,
    defenceBonus: { stab: -90, slash: -90, crush: -90, magic: -90, ranged: -90 },
    drops: [],
  }
}

const maxedStats = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, prayer: 99, currentHP: 99 }
const onTask = { monsterId: 'cave_goblin', monstersRemaining: 5 }
const offTask = { monsterId: 'some_other_monster', monstersRemaining: 5 }

afterEach(() => { vi.restoreAllMocks() })

// rollDamage: first random is the hit-chance check (0 always hits), second is
// randInt(1, maxHit) (just under 1 -> exactly maxHit). Guaranteed-hit specials
// roll randInt only, so an extra leading 0 is harmless.
function forceMaxRolls() {
  vi.spyOn(Math, 'random').mockReturnValue(0.999999999)
}

function specTotal(weaponId: string, combatType: string, slayerTask: any, extraGear: any = {}) {
  const state: any = createCombatState(buildMonster(), combatType, 'accurate', null)
  state.specialAttackEnergy = 100
  forceMaxRolls()
  const { events } = applySpecialAttack(
    state, maxedStats, { weapon: { itemId: weaponId }, ...extraGear }, itemsData, slayerTask, {},
  )
  const hit = events.find((e: any) => e.type === 'specialHit')
  expect(hit).toBeDefined()
  return hit!.totalDamage as number
}

describe('special attacks apply on-task slayer damage, in every style', () => {
  const cases: Array<[string, string, string]> = [
    ['melee', 'test_dagger', 'melee'],
    ['ranged', 'test_crossbow', 'ranged'],
    ['magic', 'test_staff', 'magic'],
  ]

  for (const [label, weaponId, combatType] of cases) {
    it(`scales a ${label} special's damage by the slayer bonus when on task`, () => {
      const bare = specTotal(weaponId, combatType, onTask)
      const helmed = specTotal(weaponId, combatType, onTask, { head: { itemId: 'slayer_helmet' } })
      expect(bare).toBeGreaterThan(0)
      expect(helmed).toBeGreaterThan(bare)
    })

    it(`leaves a ${label} special's damage alone when the helmet is worn off task`, () => {
      expect(specTotal(weaponId, combatType, offTask, { head: { itemId: 'slayer_helmet' } }))
        .toBe(specTotal(weaponId, combatType, offTask))
    })
  }
})

describe('special attacks apply on-task slayer accuracy', () => {
  // Accuracy is only observable through whether rolls connect, so this drives a
  // fixed pseudo-random sequence — identical for both runs — and counts what
  // lands across many attempts. Higher accuracy can only flip misses into hits
  // on that shared sequence, never the reverse, so more total damage is the
  // accuracy bonus and nothing else. A single straddling draw would depend on
  // guessing the exact threshold; this does not.
  function seeded() {
    let s = 987654321
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648
      return s / 2147483648
    }
  }

  function damageOver(attempts: number, withHelmet: boolean) {
    const next = seeded()
    vi.spyOn(Math, 'random').mockImplementation(next)
    const equipment: any = { weapon: { itemId: 'test_dagger' } }
    if (withHelmet) equipment.head = { itemId: 'slayer_helmet' }
    let total = 0
    for (let i = 0; i < attempts; i++) {
      const monster = buildMonster()
      // Defence tuned so the spec lands some of the time — leaving room for the
      // accuracy bonus to show, rather than sitting pinned at always/never.
      monster.stats.defence = 220
      monster.defenceBonus = { stab: 200, slash: 200, crush: 200, magic: 200, ranged: 200 }
      const state: any = createCombatState(monster, 'melee', 'accurate', null)
      state.specialAttackEnergy = 100
      const { events } = applySpecialAttack(state, maxedStats, equipment, itemsData, onTask, {})
      const hit = events.find((e: any) => e.type === 'specialHit')
      total += (hit?.totalDamage as number) ?? 0
    }
    vi.restoreAllMocks()
    return total
  }

  it('lands more of the same rolls on task wearing a slayer helmet', () => {
    const without = damageOver(200, false)
    const withHelm = damageOver(200, true)
    expect(without).toBeGreaterThan(0)
    expect(withHelm).toBeGreaterThan(without)
  })
})

describe('a special and an ordinary swing agree on the slayer bonus', () => {
  it('scales the spec by the same multiplier, derived from the engine formulas', () => {
    // The ordinary swing's on-task uplift, measured through processCombatTick.
    const normalHit = (withHelmet: boolean) => {
      const equipment: any = { weapon: { itemId: 'test_dagger' } }
      if (withHelmet) equipment.head = { itemId: 'slayer_helmet' }
      vi.spyOn(Math, 'random').mockReturnValue(0.999999999)
      const { events } = processCombatTick(
        createCombatState(buildMonster(), 'melee', 'aggressive'),
        maxedStats, equipment, itemsData, {}, [], onTask,
      )
      const hit = events.find((e: any) => e.type === 'playerHit')
      vi.restoreAllMocks()
      return (hit?.damage as number) ?? 0
    }
    expect(normalHit(true)).toBe(Math.floor(normalHit(false) * (1 + SLAYER_PCT / 100)))

    // The spec's number is derived the same way, from the engine's own
    // formulas: accurate-stance max hit, scaled by the slayer bonus, then by
    // double_hit's own 115%, landed twice. Flooring happens at each step, which
    // is why this is computed rather than compared as a ratio.
    const effStr = effectiveStrength(maxedStats.strength, 0, 1.0, getMeleeStyleBonuses('accurate').strengthStyleBonus)
    const baseMax = wornMeleeMaxHit(effStr, itemsData.test_dagger.otherBonus)
    const expectedPerHit = (slayerMult: number) => Math.floor(Math.floor(baseMax * slayerMult) * 1.15)

    expect(specTotal('test_dagger', 'melee', onTask)).toBe(2 * expectedPerHit(1))
    expect(specTotal('test_dagger', 'melee', onTask, { head: { itemId: 'slayer_helmet' } }))
      .toBe(2 * expectedPerHit(1 + SLAYER_PCT / 100))
  })
})
