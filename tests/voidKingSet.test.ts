import { describe, expect, it } from 'vitest'
import {
  hasFullVoidKingSet,
  getVoidKingCombatMultipliers,
} from '../src/engine/combatSetBonuses.js'
import { rollMeleeAttack } from '../src/engine/combatPrimitives.js'
import { buildPlayerCombatant } from '../src/engine/combatant.js'

const fullSet = {
  head: { itemId: 'void_king_helm' },
  body: { itemId: 'void_king_top' },
  legs: { itemId: 'void_king_robe' },
  gloves: { itemId: 'void_king_gloves' },
}

const inactiveMultipliers = {
  meleeAccuracy: 1,
  meleeDamage: 1,
  rangedAccuracy: 1,
  rangedDamage: 1,
  magicAccuracy: 1,
  magicDamageBonusFlat: 0,
  accuracyFlat: 0,
}

describe('hasFullVoidKingSet', () => {
  it('returns true when all four canonical pieces are equipped', () => {
    expect(hasFullVoidKingSet(fullSet)).toBe(true)
  })

  it('returns false when any one slot is missing', () => {
    for (const slot of ['head', 'body', 'legs', 'gloves'] as const) {
      const partial = { ...fullSet, [slot]: null }
      expect(hasFullVoidKingSet(partial)).toBe(false)
    }
  })

  it('returns false when gloves are in the legacy "hands" slot only', () => {
    const misslotted = { ...fullSet, gloves: null, hands: { itemId: 'void_king_gloves' } }
    expect(hasFullVoidKingSet(misslotted)).toBe(false)
  })

  it('still grants the bonus for legacy void_knight_* itemIds (pre-migration saves)', () => {
    const legacy = {
      head: { itemId: 'void_knight_helm' },
      body: { itemId: 'void_knight_top' },
      legs: { itemId: 'void_knight_robe' },
      gloves: { itemId: 'void_knight_gloves' },
    }
    expect(hasFullVoidKingSet(legacy)).toBe(true)
  })

  it('returns false for empty equipment', () => {
    expect(hasFullVoidKingSet({})).toBe(false)
    expect(hasFullVoidKingSet(null as any)).toBe(false)
  })
})

describe('getVoidKingCombatMultipliers', () => {
  it('returns neutral multipliers without the full set', () => {
    expect(getVoidKingCombatMultipliers({})).toEqual(inactiveMultipliers)
  })

  it('applies the +12.5% melee/ranged and +45% magic accuracy bonuses', () => {
    const mult = getVoidKingCombatMultipliers(fullSet)
    expect(mult.meleeAccuracy).toBe(1.125)
    expect(mult.meleeDamage).toBe(1.125)
    expect(mult.rangedAccuracy).toBe(1.125)
    expect(mult.rangedDamage).toBe(1.125)
    expect(mult.magicAccuracy).toBe(1.45)
  })

  it('applies +10 magic damage bonus (≈ +10% magic damage)', () => {
    const mult = getVoidKingCombatMultipliers(fullSet)
    expect(mult.magicDamageBonusFlat).toBe(10)
  })
})

// Integration: the same swing through rollMeleeAttack should show a higher
// maxHit / atkRoll once the full void set is equipped. Catches the #514-style
// regression where consumers miss the helper's plumbing.
describe('void king bonuses flow through rollMeleeAttack', () => {
  const items: any = {
    nether_demon_whip: {
      id: 'nether_demon_whip', slot: 'weapon', attackStyle: 'slash', attackSpeed: 4,
      attackBonus: { stab: 0, slash: 82, crush: 0, magic: 0, ranged: 0 },
      defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
      otherBonus: { meleeStrength: 82, rangedStrength: 0, magicDamage: 0 },
    },
    void_king_helm:    { id: 'void_king_helm',    slot: 'head',   attackBonus: {}, defenceBonus: {}, otherBonus: {} },
    void_king_top:     { id: 'void_king_top',     slot: 'body',   attackBonus: {}, defenceBonus: {}, otherBonus: {} },
    void_king_robe:    { id: 'void_king_robe',    slot: 'legs',   attackBonus: {}, defenceBonus: {}, otherBonus: {} },
    void_king_gloves:  { id: 'void_king_gloves',  slot: 'gloves', attackBonus: {}, defenceBonus: {}, otherBonus: {} },
  }

  function combatant(equipment: any, id = 1) {
    return buildPlayerCombatant({
      characterId: id,
      username: 'Tester',
      stats: {
        attack:    { xp: 13_034_431, level: 99 },
        strength:  { xp: 13_034_431, level: 99 },
        defence:   { xp: 13_034_431, level: 99 },
        hitpoints: { xp: 13_034_431, level: 99 },
        ranged:    { xp: 13_034_431, level: 99 },
        magic:     { xp: 13_034_431, level: 99 },
        prayer:    { xp: 13_034_431, level: 99 },
      },
      equipment,
      inventory: [],
      stance: 'aggressive',
      itemsData: items,
    })
  }

  it('full void king set raises melee max hit by 12.5% vs no set', () => {
    const baseline = combatant({ weapon: { itemId: 'nether_demon_whip' } }, 1)
    const voided = combatant({
      weapon: { itemId: 'nether_demon_whip' },
      head: { itemId: 'void_king_helm' },
      body: { itemId: 'void_king_top' },
      legs: { itemId: 'void_king_robe' },
      gloves: { itemId: 'void_king_gloves' },
    }, 2)
    const target = combatant({}, 99)
    const baseSwing = rollMeleeAttack(baseline, target, items)
    const voidSwing = rollMeleeAttack(voided, target, items)
    expect(voidSwing.maxHit).toBe(Math.floor(baseSwing.maxHit * 1.125))
    expect(voidSwing.attackRoll).toBe(Math.floor(baseSwing.attackRoll * 1.125))
  })

  it('partial set (missing gloves) grants no melee bonus', () => {
    const partial = combatant({
      weapon: { itemId: 'nether_demon_whip' },
      head: { itemId: 'void_king_helm' },
      body: { itemId: 'void_king_top' },
      legs: { itemId: 'void_king_robe' },
    }, 1)
    const baseline = combatant({ weapon: { itemId: 'nether_demon_whip' } }, 2)
    const target = combatant({}, 99)
    expect(rollMeleeAttack(partial, target, items).maxHit).toBe(rollMeleeAttack(baseline, target, items).maxHit)
  })
})
