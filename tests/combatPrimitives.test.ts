// Smoke tests for the symmetric attack rollers. We don't pin exact
// damage numbers (RNG-driven via Math.random), but we pin the structural
// invariants that prove the asymmetry the reviewer flagged is gone:
//
//   1. Two identical Combatants produce identical attack/defence rolls
//      against each other (no "player gets +1" handicap).
//   2. Higher attack stat → higher hit chance, lower defence stat →
//      higher hit chance.
//   3. Stance bonuses flow through the rollers correctly.

import { describe, it, expect } from 'vitest'
import { rollMeleeAttack, rollRangedAttack, rollMagicAttack } from '../src/engine/combatPrimitives.js'
import { buildPlayerCombatant } from '../src/engine/combatant.js'

const items = {
  abyssal_whip: {
    id: 'abyssal_whip', slot: 'weapon', attackStyle: 'slash', attackSpeed: 4,
    attackBonus: { stab: 0, slash: 82, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 82, rangedStrength: 0, magicDamage: 0 },
  },
  rune_platebody: {
    id: 'rune_platebody', slot: 'body',
    attackBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 82, slash: 80, crush: 72, magic: -6, ranged: 80 },
    otherBonus: {},
  },
  magic_shortbow: {
    id: 'magic_shortbow', slot: 'weapon', attackStyle: 'ranged', attackSpeed: 4,
    attackBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 69 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 0, rangedStrength: 0, magicDamage: 0 },
  },
}

function buildPlayer(overrides: any = {}) {
  return buildPlayerCombatant({
    characterId: overrides.characterId ?? 1,
    username: overrides.username ?? 'Tester',
    stats: {
      attack:    { xp: 13_034_431, level: 99 },
      strength:  { xp: 13_034_431, level: 99 },
      defence:   { xp: 13_034_431, level: 99 },
      hitpoints: { xp: 13_034_431, level: 99 },
      ranged:    { xp: 13_034_431, level: 99 },
      magic:     { xp: 13_034_431, level: 99 },
      prayer:    { xp: 13_034_431, level: 99 },
      ...overrides.stats,
    },
    equipment: overrides.equipment ?? {},
    inventory: [],
    stance: overrides.stance ?? 'aggressive',
    itemsData: items,
  })
}

describe('rollMeleeAttack', () => {
  it('two identical attackers produce identical max hits and rolls (symmetric)', () => {
    const a = buildPlayer({ characterId: 1, equipment: { weapon: { itemId: 'abyssal_whip' } } })
    const b = buildPlayer({ characterId: 2, equipment: { weapon: { itemId: 'abyssal_whip' } } })

    // We can't pin the damage roll (Math.random) but the maxHit + roll
    // calculations should be deterministic and equal in both directions.
    const aToB = rollMeleeAttack(a, b, items)
    const bToA = rollMeleeAttack(b, a, items)
    expect(aToB.maxHit).toBe(bToA.maxHit)
    expect(aToB.attackRoll).toBe(bToA.attackRoll)
    expect(aToB.defenceRoll).toBe(bToA.defenceRoll)
    expect(aToB.style).toBe('slash')
  })

  it('aggressive stance gives a higher max hit than defensive', () => {
    const aggressive = buildPlayer({ stance: 'aggressive', equipment: { weapon: { itemId: 'abyssal_whip' } } })
    const defensive  = buildPlayer({ stance: 'defensive',  equipment: { weapon: { itemId: 'abyssal_whip' } } })
    const target     = buildPlayer({ characterId: 99 })
    const swingAg = rollMeleeAttack(aggressive, target, items)
    const swingDe = rollMeleeAttack(defensive,  target, items)
    expect(swingAg.maxHit).toBeGreaterThan(swingDe.maxHit)
  })

  it('better defender equipment lowers attacker accuracy', () => {
    const attacker = buildPlayer({ equipment: { weapon: { itemId: 'abyssal_whip' } } })
    const naked    = buildPlayer({ characterId: 2 })
    const armoured = buildPlayer({ characterId: 3, equipment: { body: { itemId: 'rune_platebody' } } })
    const swingNaked    = rollMeleeAttack(attacker, naked, items)
    const swingArmoured = rollMeleeAttack(attacker, armoured, items)
    expect(swingArmoured.accuracy).toBeLessThan(swingNaked.accuracy)
  })
})

describe('rollRangedAttack', () => {
  it('produces a non-zero max hit with a ranged weapon', () => {
    const archer = buildPlayer({ stance: 'rapid', equipment: { weapon: { itemId: 'magic_shortbow' } } })
    const target = buildPlayer({ characterId: 2 })
    const swing = rollRangedAttack(archer, target, items)
    expect(swing.maxHit).toBeGreaterThan(0)
    expect(swing.style).toBe('ranged')
  })
})

describe('rollMagicAttack', () => {
  it('returns zero damage when no spell and no override', () => {
    const caster = buildPlayer()
    const target = buildPlayer({ characterId: 2 })
    const swing = rollMagicAttack(caster, target, items)
    expect(swing.maxHit).toBe(0)
    expect(swing.damage).toBe(0)
  })

  it('uses spell baseDamage when provided', () => {
    const caster = buildPlayer()
    const target = buildPlayer({ characterId: 2 })
    const swing = rollMagicAttack(caster, target, items, {
      spell: { id: 'fire_blast', baseDamage: 16, baseXP: 34, runeReq: {} },
    })
    expect(swing.maxHit).toBeGreaterThan(0)
    expect(swing.style).toBe('magic')
  })
})

describe('buildPlayerCombatant', () => {
  it('starts both combatants at identical attack timers (no first-hit handicap)', () => {
    const a = buildPlayer({ characterId: 1 })
    const b = buildPlayer({ characterId: 2 })
    expect(a.attackTimer).toBe(0)
    expect(b.attackTimer).toBe(0)
  })

  it('starts spec energy at 100 (PvP rule, no regen during match)', () => {
    const c = buildPlayer()
    expect(c.specialAttackEnergy).toBe(100)
    expect(c.specialAttackQueued).toBe(false)
  })

  it('protection prayer slot is permanently null (disabled in v1)', () => {
    const c = buildPlayer()
    expect(c.activeProtectionPrayer).toBeNull()
  })

  it('defaults currentHP to maxHP when not provided', () => {
    const c = buildPlayer()
    expect(c.currentHP).toBe(c.maxHP)
    expect(c.maxHP).toBe(99)   // hp level 99 → 99 hp
  })

  it('does not mutate the caller-supplied equipment object', () => {
    const eq = { weapon: { itemId: 'abyssal_whip' } }
    const c = buildPlayer({ equipment: eq })
    c.equipment.weapon!.itemId = 'mutated' as any
    expect(eq.weapon.itemId).toBe('abyssal_whip')   // original untouched
  })
})
