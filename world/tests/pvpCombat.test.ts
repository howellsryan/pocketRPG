import { describe, expect, it } from 'vitest'
import {
  beginPvpFight,
  endPvpFight,
  pvpAttackRange,
  pvpApproachPlan,
  refuseAttack,
  stepPvpFight,
  tickPvpBuffs,
  type PvpFighter,
  type PvpTickOutput,
} from '../server/pvpCombat'
import { PVP_COMBAT_LOCK_TICKS, PVP_LINE_Z } from '../shared/pvpArea'
import type { InvSlot } from '../shared/protocol'

const OPEN = Array.from({ length: 64 }, () => '.'.repeat(64))

function fighter(over: Partial<PvpFighter> = {}): PvpFighter {
  return {
    charId: 'a',
    combatantId: 1,
    name: 'A',
    x: 10,
    z: PVP_LINE_Z - 10,
    hp: 99,
    maxHp: 99,
    levels: { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, hitpoints: 99, prayer: 99 },
    baseLevels: { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, hitpoints: 99, prayer: 99 },
    combatLevel: 99,
    equipment: { weapon: { itemId: 'dragon_scimitar' } },
    inventory: new Array<InvSlot>(28).fill(null),
    stance: 'aggressive',
    spell: null,
    prayerPoints: 99,
    maxPrayerPoints: 99,
    prayerDrainAccumulator: 0,
    activeProtectionPrayer: null,
    activeCombatPrayer: null,
    activePotions: {},
    specialEnergy: 100,
    specialAttackQueued: false,
    pvpAttackTimer: 0,
    pvpOpponentId: null,
    pvpLockUntilTick: 0,
    isBot: false,
    anim: 'idle',
    ...over,
  }
}

const out = (): PvpTickOutput => ({ swings: [], deaths: [] })
const ctx = (tick = 100) => ({ tick, collision: OPEN })

/** Runs the duel until one of them lands a swing, or gives up. Swing damage is
 * random, so behavioural tests assert on the SHAPE of what came out rather than
 * on a number. */
function runUntilSwing(a: PvpFighter, b: PvpFighter, ticks = 30): PvpTickOutput {
  const result = out()
  for (let i = 0; i < ticks && result.swings.length === 0; i++) {
    stepPvpFight(a, b, ctx(100 + i), result)
  }
  return result
}

describe('reach', () => {
  it('lets adjacent melee fighters swing', () => {
    const a = fighter({ charId: 'a', combatantId: 1, x: 10 })
    const b = fighter({ charId: 'b', combatantId: 2, x: 11 })
    beginPvpFight(a, b, 100)
    expect(runUntilSwing(a, b).swings.length).toBeGreaterThan(0)
  })

  it('lands nothing when melee fighters are a zone apart', () => {
    const a = fighter({ charId: 'a', combatantId: 1, x: 10 })
    const b = fighter({ charId: 'b', combatantId: 2, x: 40 })
    beginPvpFight(a, b, 100)
    expect(runUntilSwing(a, b).swings).toEqual([])
  })

  it('is asymmetric: a mage at 6 tiles hits a melee opponent who cannot reach back', () => {
    const mage = fighter({
      charId: 'a', combatantId: 1, x: 10,
      equipment: { weapon: { itemId: 'trident_of_venom' } },
    })
    const melee = fighter({ charId: 'b', combatantId: 2, x: 16 })
    expect(pvpAttackRange(mage)).toBeGreaterThan(pvpAttackRange(melee))
    beginPvpFight(mage, melee, 100)
    const result = runUntilSwing(mage, melee, 40)
    expect(result.swings.length).toBeGreaterThan(0)
    expect(result.swings.every((s) => s.attackerId === 'a')).toBe(true)
  })
})

describe('the safe camp', () => {
  it('resolves nothing when either fighter is south of the line', () => {
    const a = fighter({ charId: 'a', combatantId: 1, x: 10, z: PVP_LINE_Z - 1 })
    const b = fighter({ charId: 'b', combatantId: 2, x: 11, z: PVP_LINE_Z })
    beginPvpFight(a, b, 100)
    expect(runUntilSwing(a, b).swings).toEqual([])
  })
})

describe('the single-combat lock', () => {
  it('locks both sides, not just the aggressor', () => {
    const a = fighter({ charId: 'a', combatantId: 1 })
    const b = fighter({ charId: 'b', combatantId: 2, x: 11 })
    beginPvpFight(a, b, 100)
    expect(a.pvpOpponentId).toBe('b')
    expect(b.pvpOpponentId).toBe('a')
    expect(b.pvpLockUntilTick).toBe(100 + PVP_COMBAT_LOCK_TICKS)
  })

  it('is refreshed by staying in reach, so a live fight never lapses', () => {
    const a = fighter({ charId: 'a', combatantId: 1 })
    const b = fighter({ charId: 'b', combatantId: 2, x: 11 })
    beginPvpFight(a, b, 100)
    stepPvpFight(a, b, ctx(110), out())
    expect(a.pvpLockUntilTick).toBe(110 + PVP_COMBAT_LOCK_TICKS)
  })

  it('is NOT refreshed by a chase out of reach — that is what lets it lapse', () => {
    const a = fighter({ charId: 'a', combatantId: 1, x: 10 })
    const b = fighter({ charId: 'b', combatantId: 2, x: 40 })
    beginPvpFight(a, b, 100)
    stepPvpFight(a, b, ctx(110), out())
    expect(a.pvpLockUntilTick).toBe(100 + PVP_COMBAT_LOCK_TICKS)
  })

  it('releases both sides together', () => {
    const a = fighter({ charId: 'a', combatantId: 1 })
    const b = fighter({ charId: 'b', combatantId: 2, x: 11 })
    beginPvpFight(a, b, 100)
    endPvpFight(a, b)
    expect(a.pvpOpponentId).toBeNull()
    expect(b.pvpOpponentId).toBeNull()
    expect(b.pvpLockUntilTick).toBe(0)
  })

  it('drops an armed special when the fight ends, so it cannot fire into the next one', () => {
    const a = fighter({ charId: 'a', combatantId: 1, specialAttackQueued: true })
    const b = fighter({ charId: 'b', combatantId: 2, x: 11 })
    beginPvpFight(a, b, 100)
    endPvpFight(a, b)
    expect(a.specialAttackQueued).toBe(false)
  })

  it('puts back the defence a draining special took, on both sides', () => {
    // Nothing else in the world restores it: without this a single spec left a
    // player weaker for the whole session, across every later fight.
    const a = fighter({ charId: 'a', combatantId: 1 })
    const b = fighter({ charId: 'b', combatantId: 2, x: 11 })
    beginPvpFight(a, b, 100)
    a.levels.defence = 60
    b.levels.defence = 71
    endPvpFight(a, b)
    expect(a.levels.defence).toBe(99)
    expect(b.levels.defence).toBe(99)
  })

  it('never restores a level ABOVE what the fighter arrived with', () => {
    const a = fighter({ charId: 'a', combatantId: 1 })
    const b = fighter({ charId: 'b', combatantId: 2, x: 11 })
    a.levels.strength = 118
    beginPvpFight(a, b, 100)
    endPvpFight(a, b)
    expect(a.levels.strength).toBe(118)
  })
})

describe('refuseAttack in zone terms', () => {
  it('passes an in-bracket pair in the Wilderness and refuses them anywhere else', () => {
    const a = fighter({ charId: 'a', combatantId: 1, combatLevel: 90 })
    const b = fighter({ charId: 'b', combatantId: 2, x: 11, combatLevel: 99 })
    expect(refuseAttack('wilderness', a, b, 100)).toBeNull()
    expect(refuseAttack('overworld', a, b, 100)).toBe('not_pvp_zone')
  })
})

describe('per-tick upkeep', () => {
  it('drains the prayer pool while a prayer is on', () => {
    const a = fighter({ activeProtectionPrayer: 'protection_from_melee', prayerPoints: 50 })
    for (let i = 0; i < 200; i++) tickPvpBuffs(a)
    expect(a.prayerPoints).toBeLessThan(50)
  })

  it('leaves the pool alone when nothing is on', () => {
    const a = fighter({ prayerPoints: 50 })
    for (let i = 0; i < 200; i++) tickPvpBuffs(a)
    expect(a.prayerPoints).toBe(50)
  })

  it('switches prayers off when the pool empties', () => {
    const a = fighter({ activeCombatPrayer: 'ultimate_strength', prayerPoints: 1, maxPrayerPoints: 99 })
    for (let i = 0; i < 1000; i++) tickPvpBuffs(a)
    expect(a.prayerPoints).toBe(0)
    expect(a.activeCombatPrayer).toBeNull()
  })

  it('decays potion buffs and clears them when they run out', () => {
    const a = fighter({ activePotions: { super_strength: 2 } })
    tickPvpBuffs(a)
    expect(a.activePotions.super_strength).toBe(1)
    tickPvpBuffs(a)
    expect(a.activePotions.super_strength).toBeUndefined()
  })
})

describe('death', () => {
  it('reports the victim and the killer once HP reaches 0', () => {
    const a = fighter({ charId: 'a', combatantId: 1 })
    const b = fighter({ charId: 'b', combatantId: 2, x: 11, hp: 1, maxHp: 99, levels: { attack: 1, strength: 1, defence: 1, ranged: 1, magic: 1, hitpoints: 1, prayer: 1 }, equipment: {} })
    beginPvpFight(a, b, 100)
    const result = out()
    for (let i = 0; i < 60 && result.deaths.length === 0; i++) stepPvpFight(a, b, ctx(100 + i), result)
    expect(result.deaths).toEqual([{ victimId: 'b', killerId: 'a' }])
    expect(b.hp).toBe(0)
  })
})

describe('protection prayers', () => {
  it('cut incoming melee damage for the defender who prayed', () => {
    // Run the same fight twice with the same attacker; over many swings the
    // prayed-against total must come out lower. Damage is random, so this is a
    // volume comparison rather than a single-swing assertion.
    const totalFor = (protection: string | null): number => {
      let total = 0
      for (let round = 0; round < 60; round++) {
        const a = fighter({ charId: 'a', combatantId: 1, x: 10 })
        const b = fighter({
          charId: 'b', combatantId: 2, x: 11, hp: 9999, maxHp: 9999,
          activeProtectionPrayer: protection, prayerPoints: 9999, maxPrayerPoints: 9999,
        })
        beginPvpFight(a, b, 100)
        const result = out()
        for (let i = 0; i < 12; i++) stepPvpFight(a, b, ctx(100 + i), result)
        total += result.swings.filter((s) => s.attackerId === 'a').reduce((sum, s) => sum + s.damage, 0)
      }
      return total
    }
    expect(totalFor('protection_from_melee')).toBeLessThan(totalFor(null))
  })

  it('does not cut damage from a style it does not answer', () => {
    const a = fighter({ charId: 'a', combatantId: 1, x: 10 })
    const b = fighter({
      charId: 'b', combatantId: 2, x: 11, hp: 9999, maxHp: 9999,
      activeProtectionPrayer: 'protection_from_magic', prayerPoints: 9999, maxPrayerPoints: 9999,
    })
    beginPvpFight(a, b, 100)
    const result = out()
    for (let i = 0; i < 200; i++) stepPvpFight(a, b, ctx(100 + i), result)
    // A melee scimitar against protect-from-magic must still be landing real hits.
    expect(result.swings.some((s) => s.attackerId === 'a' && s.damage > 0)).toBe(true)
  })
})

describe('disengaging by walking away', () => {
  it('stops the walker landing anything while their opponent keeps swinging', () => {
    // Both in reach, but the walker has disengaged: every swing this tick must
    // belong to the one who stayed. Regression — a ranged fighter used to keep
    // firing at a player they were running away from.
    const runner = fighter({ charId: 'a', combatantId: 1, x: 10, pvpPassive: true })
    const chaser = fighter({ charId: 'b', combatantId: 2, x: 11 })
    beginPvpFight(runner, chaser, 100)
    const result = out()
    for (let i = 0; i < 30; i++) stepPvpFight(runner, chaser, ctx(100 + i), result)
    expect(result.swings.length).toBeGreaterThan(0)
    expect(result.swings.every((s) => s.attackerId === 'b')).toBe(true)
  })

  it('holds true at range, where the disengaged fighter could still reach', () => {
    const runner = fighter({
      charId: 'a', combatantId: 1, x: 10, pvpPassive: true,
      equipment: { weapon: { itemId: 'trident_of_venom' } },
    })
    const chaser = fighter({ charId: 'b', combatantId: 2, x: 15, equipment: { weapon: { itemId: 'trident_of_venom' } } })
    beginPvpFight(runner, chaser, 100)
    const result = out()
    for (let i = 0; i < 30; i++) stepPvpFight(runner, chaser, ctx(100 + i), result)
    expect(result.swings.some((s) => s.attackerId === 'b')).toBe(true)
    expect(result.swings.some((s) => s.attackerId === 'a')).toBe(false)
  })

  it('clears on release, so the next fight starts live', () => {
    const a = fighter({ charId: 'a', combatantId: 1, pvpPassive: true })
    const b = fighter({ charId: 'b', combatantId: 2, x: 11 })
    beginPvpFight(a, b, 100)
    endPvpFight(a, b)
    expect(a.pvpPassive).toBe(false)
  })
})

describe('pvpApproachPlan', () => {
  const at = (x: number, z = 0) => ({ x, z })

  it('arrives once inside the attacker’s own reach', () => {
    expect(pvpApproachPlan(at(10), at(15), 5, null, 3).kind).toBe('arrived')
    expect(pvpApproachPlan(at(10), at(11), 1, null, 3).kind).toBe('arrived')
  })

  it('re-paths when the target has moved off the tile the path was built for', () => {
    // The bug: a bow-armed bot holds at its own range and drifts, so the path
    // computed at the click walked to a tile it had already left.
    expect(pvpApproachPlan(at(0), at(20), 5, { x: 22, z: 0 }, 6).kind).toBe('repath')
  })

  it('holds a live path while the target stands still', () => {
    expect(pvpApproachPlan(at(0), at(20), 5, { x: 20, z: 0 }, 6).kind).toBe('hold')
  })

  it('re-paths when the path has run out without arriving', () => {
    // Otherwise the chase stalls forever one tile short and the attack intent
    // hangs, which reads in-game as "the attack simply does nothing".
    expect(pvpApproachPlan(at(0), at(20), 5, { x: 20, z: 0 }, 0).kind).toBe('repath')
  })

  it('re-paths when there is no chase tile at all (a fresh click)', () => {
    expect(pvpApproachPlan(at(0), at(20), 5, null, 4).kind).toBe('repath')
  })
})
