import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'
import spellsData from '../src/data/spells.json'
import { estimateDps, monsterTargets, referenceTarget, timeToKill, loadoutBlockedReason } from '../src/engine/dpsCalculator.js'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'
import { getXPForLevel } from '../src/engine/experience.js'

const items = itemsData as Record<string, any>
const monsters = monstersData as Record<string, any>

const levelsAt = (level: number) => ({
  attack: level, strength: level, defence: level, ranged: level, magic: level, hitpoints: level, prayer: level,
})

// The live fight's own damage roll, driven by a fixed sequence so a simulated
// average is deterministic. estimateDps replaces exactly this roll with its
// expectation, so a long simulation must land on the estimate.
function simulateAverageDamagePerTick(opts: {
  monsterId: string
  equipment: Record<string, any>
  combatType: string
  stance: string
  spell?: any
  level: number
  swings: number
}) {
  const { monsterId, equipment, combatType, stance, spell, level, swings } = opts
  const stats: any = { attack: level, strength: level, defence: level, ranged: level, magic: level, hitpoints: level, currentHP: 990000, maxHP: 990000 }
  let seed = 1234567
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const originalRandom = Math.random
  Math.random = random

  let totalDamage = 0
  let ticksSpent = 0
  try {
    for (let i = 0; i < swings; i++) {
      const monster = { ...monsters[monsterId], hitpoints: 10_000_000 }
      const state: any = createCombatState(monster, combatType, stance, spell || null, null)
      state.playerAttackTimer = 0
      state.monsterAttackTimer = 9999
      state.specialAttackQueued = false
      const before = state.monster.currentHP
      const inventory = spell ? [{ itemId: 'law_rune', quantity: 100000 }] : []
      const { combatState } = processCombatTick(state, stats, equipment, items, {}, inventory, null)
      totalDamage += before - combatState.monster.currentHP
      ticksSpent += combatState.playerAttackTimer || 1
    }
  } finally {
    Math.random = originalRandom
  }
  return totalDamage / ticksSpent
}

describe('estimateDps matches the live combat maths', () => {
  const cases = [
    {
      name: 'melee, aggressive stance',
      style: 'melee', stance: 'aggressive', combatType: 'melee',
      equipment: { weapon: { itemId: 'runeforged_scimitar' }, body: { itemId: 'runeforged_platebody' } },
    },
    {
      name: 'ranged, rapid stance with ammo',
      style: 'ranged', stance: 'rapid', combatType: 'ranged',
      equipment: { weapon: { itemId: 'magic_shortbow' }, ammo: { itemId: 'runeforged_arrow', quantity: 100000 } },
    },
  ]

  for (const c of cases) {
    it(`${c.name} — expectation equals a long simulation`, () => {
      // A monster with plain stats and one form, so the simulation and the
      // estimate face the same defensive profile every swing.
      const monsterId = 'ember_giant'
      expect(monsters[monsterId]).toBeTruthy()
      const level = 70
      const target = monsterTargets({ ...monsters[monsterId], id: monsterId })[0]

      const estimate = estimateDps({
        style: c.style, stance: c.stance, levels: levelsAt(level),
        equipment: c.equipment, itemsData: items, target,
      })
      const simulated = simulateAverageDamagePerTick({
        monsterId, equipment: c.equipment, combatType: c.combatType,
        stance: c.stance, level, swings: 40_000,
      })

      expect(estimate.dps).toBeGreaterThan(0)
      // damage-per-tick from the estimate; 0.6s per tick.
      const estimatedPerTick = estimate.dps * 0.6
      expect(simulated).toBeGreaterThan(estimatedPerTick * 0.93)
      expect(simulated).toBeLessThan(estimatedPerTick * 1.07)
    })
  }

  it('reports the same max hit the fight rolls against', () => {
    const target = monsterTargets({ ...monsters.ember_giant, id: 'ember_giant' })[0]
    const r = estimateDps({
      style: 'melee', stance: 'aggressive', levels: levelsAt(99),
      equipment: { weapon: { itemId: 'runeforged_scimitar' } }, itemsData: items, target,
    })
    // Same formula the fight uses: effectiveStrength(99,0,1,+3) with the
    // scimitar's melee strength bonus.
    const effStr = 99 + 3 + 8
    const expected = Math.floor(0.5 + (effStr * ((items.runeforged_scimitar.otherBonus.meleeStrength || 0) + 64)) / 640)
    expect(r.maxHit).toBe(expected)
  })
})

describe('estimateDps guard rails', () => {
  const target = monsterTargets({ ...monsters.ember_giant, id: 'ember_giant' })[0]

  it('scores a bow with no ammo as zero', () => {
    const r = estimateDps({
      style: 'ranged', levels: levelsAt(99), stance: 'rapid',
      equipment: { weapon: { itemId: 'magic_shortbow' } }, itemsData: items, target,
    })
    expect(r.dps).toBe(0)
    expect(r.blocked).toBe('no_ammo')
  })

  it('scores magic with no spell and no powered staff as zero', () => {
    const staff = Object.entries(items).find(([, it]: any) => it.slot === 'weapon' && it.attackStyle === 'magic' && !it.poweredStaff)
    expect(staff).toBeTruthy()
    const r = estimateDps({
      style: 'magic', levels: levelsAt(99),
      equipment: { weapon: { itemId: staff![0] } }, itemsData: items, target, spell: null,
    })
    expect(r.dps).toBe(0)
    expect(r.blocked).toBe('no_spell')
  })

  it('refuses to rate a ranged weapon as a melee setup', () => {
    expect(loadoutBlockedReason({
      style: 'melee', equipment: { weapon: { itemId: 'magic_shortbow' } }, itemsData: items, spell: null,
    })).toBe('wrong_weapon_style')
  })

  it('rates a spell-less staff as the melee swing combat.js actually makes', () => {
    const staffId = Object.entries(items).find(([, it]: any) =>
      it.slot === 'weapon' && it.attackStyle === 'magic' && !it.poweredStaff && (it.otherBonus?.meleeStrength || 0) > 0)?.[0]
    if (!staffId) return
    const r = estimateDps({
      style: 'melee', stance: 'aggressive', levels: levelsAt(99),
      equipment: { weapon: { itemId: staffId } }, itemsData: items, target,
    })
    expect(r.blocked).toBeUndefined()
    expect(r.dps).toBeGreaterThan(0)
  })

  it('a form immune to the style contributes no damage', () => {
    const immuneMonster = Object.entries(monsters).find(([, m]: any) =>
      m.forms && Object.values(m.forms).some((f: any) => f?.immunity))
    if (!immuneMonster) return
    const [id, monster] = immuneMonster as [string, any]
    const immuneStyle = Object.values(monster.forms).map((f: any) => f?.immunity).find(Boolean)
    const form = monsterTargets({ ...monster, id }).find((t) => t.immunity === immuneStyle)
    expect(form).toBeTruthy()
    const r = estimateDps({
      style: immuneStyle, stance: 'aggressive', levels: levelsAt(99),
      equipment: { weapon: { itemId: 'runeforged_scimitar' } }, itemsData: items, target: form!,
    })
    expect(r.dps).toBe(0)
    expect(r.immune).toBe(true)
  })
})

describe('target models', () => {
  it('splits a multi-form boss into one target per form', () => {
    const multi = Object.entries(monsters).find(([, m]: any) => m.multiForm && m.forms && Object.keys(m.forms).length > 1)
    expect(multi).toBeTruthy()
    const [id, monster] = multi as [string, any]
    const targets = monsterTargets({ ...monster, id })
    expect(targets.length).toBe(Object.keys(monster.forms).length)
    // Weights are a distribution over the fight, not per-form counts.
    expect(targets.reduce((s, t) => s + t.weight, 0)).toBeCloseTo(1, 5)
  })

  it('a single-form monster is one target at full weight', () => {
    const targets = monsterTargets({ ...monsters.ember_giant, id: 'ember_giant' })
    expect(targets).toHaveLength(1)
    expect(targets[0].weight).toBe(1)
    expect(targets[0].defenceLevel).toBe(monsters.ember_giant.stats.defence)
  })

  it('the reference target averages real monsters near the combat level', () => {
    const ref = referenceTarget(monsters, 70)
    expect(ref.sampleSize).toBeGreaterThan(0)
    expect(ref.targets).toHaveLength(1)
    expect(ref.targets[0].defenceLevel).toBeGreaterThan(0)
  })

  it('time to kill is null when nothing can be dealt', () => {
    expect(timeToKill(100, 0)).toBeNull()
    expect(timeToKill(100, 10)).toBe(10)
  })
})

describe('spell and staff magic paths', () => {
  it('a powered staff needs no spell and scales with Magic level', () => {
    const staffEntry = Object.entries(items).find(([, it]: any) => it.slot === 'weapon' && it.poweredStaff)
    expect(staffEntry).toBeTruthy()
    const [staffId] = staffEntry as [string, any]
    const target = monsterTargets({ ...monsters.ember_giant, id: 'ember_giant' })[0]
    const low = estimateDps({ style: 'magic', levels: levelsAt(50), equipment: { weapon: { itemId: staffId } }, itemsData: items, target })
    const high = estimateDps({ style: 'magic', levels: levelsAt(99), equipment: { weapon: { itemId: staffId } }, itemsData: items, target })
    expect(high.maxHit).toBeGreaterThan(low.maxHit)
    expect(high.dps).toBeGreaterThan(low.dps)
  })

  it('a stronger spell out-damages a weaker one on the same staff', () => {
    const spells = spellsData as Record<string, any>
    const staffEntry = Object.entries(items).find(([, it]: any) => it.slot === 'weapon' && it.attackStyle === 'magic' && !it.poweredStaff)
    const [staffId] = staffEntry as [string, any]
    const target = monsterTargets({ ...monsters.ember_giant, id: 'ember_giant' })[0]
    const ranked = Object.values(spells).filter((s: any) => s.baseDamage > 0).sort((a: any, b: any) => a.baseDamage - b.baseDamage)
    const weak = estimateDps({ style: 'magic', levels: levelsAt(99), equipment: { weapon: { itemId: staffId } }, itemsData: items, target, spell: ranked[0] })
    const strong = estimateDps({ style: 'magic', levels: levelsAt(99), equipment: { weapon: { itemId: staffId } }, itemsData: items, target, spell: ranked.at(-1) })
    expect(strong.dps).toBeGreaterThan(weak.dps)
  })
})
