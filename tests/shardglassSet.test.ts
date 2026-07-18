import { describe, expect, it } from 'vitest'
import {
  hasFullShardglassSet,
  getCombatSetMultipliers,
} from '../src/engine/combatSetBonuses.js'
import { rollMeleeAttack, rollRangedAttack } from '../src/engine/combatPrimitives.js'
import { buildPlayerCombatant } from '../src/engine/combatant.js'
import itemsData from '../src/data/items.json'

const armour = {
  head: { itemId: 'shardglass_helmet' },
  body: { itemId: 'shardglass_plate_body' },
  legs: { itemId: 'shardglass_platelegs' },
}

const fullSetWithSaeldor = { ...armour, weapon: { itemId: 'blade_of_saeldor' } }
const fullSetWithFaerdhinen = { ...armour, weapon: { itemId: 'bow_of_faerdhinen' } }
const fullSetWithShardglassBow = { ...armour, weapon: { itemId: 'shardglass_bow' } }

describe('hasFullShardglassSet', () => {
  it('returns true with all 3 armour pieces + the Saeldor Warblade', () => {
    expect(hasFullShardglassSet(fullSetWithSaeldor)).toBe(true)
  })

  it('returns true with all 3 armour pieces + the Faerdhinen Warbow', () => {
    expect(hasFullShardglassSet(fullSetWithFaerdhinen)).toBe(true)
  })

  it('returns true with all 3 armour pieces + the Shardglass Bow', () => {
    expect(hasFullShardglassSet(fullSetWithShardglassBow)).toBe(true)
  })

  it('returns false when any one armour slot is missing', () => {
    for (const slot of ['head', 'body', 'legs'] as const) {
      const partial = { ...fullSetWithSaeldor, [slot]: null }
      expect(hasFullShardglassSet(partial)).toBe(false)
    }
  })

  it('returns false with the full armour set but no qualifying weapon', () => {
    expect(hasFullShardglassSet({ ...armour, weapon: null })).toBe(false)
    expect(hasFullShardglassSet({ ...armour, weapon: { itemId: 'runeforged_scimitar' } })).toBe(false)
  })

  it('returns false for empty equipment', () => {
    expect(hasFullShardglassSet({})).toBe(false)
    expect(hasFullShardglassSet(null as any)).toBe(false)
  })
})

describe('getCombatSetMultipliers (Shardglass)', () => {
  it('grants +30% melee/ranged/magic accuracy and +15% melee/ranged damage with a qualifying weapon', () => {
    for (const equipment of [fullSetWithSaeldor, fullSetWithFaerdhinen, fullSetWithShardglassBow]) {
      const mult = getCombatSetMultipliers(equipment)
      expect(mult.meleeAccuracy).toBe(1.3)
      expect(mult.rangedAccuracy).toBe(1.3)
      expect(mult.magicAccuracy).toBe(1.3)
      expect(mult.meleeDamage).toBe(1.15)
      expect(mult.rangedDamage).toBe(1.15)
    }
  })

  it('grants nothing without a qualifying weapon', () => {
    const mult = getCombatSetMultipliers({ ...armour, weapon: null })
    expect(mult.meleeAccuracy).toBe(1)
    expect(mult.rangedAccuracy).toBe(1)
    expect(mult.magicAccuracy).toBe(1)
    expect(mult.meleeDamage).toBe(1)
    expect(mult.rangedDamage).toBe(1)
  })

  it('grants nothing with a qualifying weapon but partial armour', () => {
    const mult = getCombatSetMultipliers({ ...fullSetWithSaeldor, legs: null })
    expect(mult.meleeAccuracy).toBe(1)
    expect(mult.meleeDamage).toBe(1)
  })
})

// Integration: the multipliers should flow through the real rollers exactly
// like Void King / Masari do, using the real Shardglass items.
describe('Shardglass set bonus flows through rollMeleeAttack / rollRangedAttack', () => {
  function combatant(equipment: any, id = 1) {
    return buildPlayerCombatant({
      characterId: id,
      username: 'Tester',
      stats: {
        attack: { xp: 13_034_431, level: 99 },
        strength: { xp: 13_034_431, level: 99 },
        defence: { xp: 13_034_431, level: 99 },
        hitpoints: { xp: 13_034_431, level: 99 },
        ranged: { xp: 13_034_431, level: 99 },
        magic: { xp: 13_034_431, level: 99 },
        prayer: { xp: 13_034_431, level: 99 },
      },
      equipment,
      inventory: [],
      stance: 'aggressive',
      itemsData,
    })
  }

  it('full Shardglass set + Saeldor Warblade raises melee accuracy and max hit by 30%/15%', () => {
    const baseline = combatant({ weapon: { itemId: 'blade_of_saeldor' } }, 1)
    const setEquipped = combatant(fullSetWithSaeldor, 2)
    const target = combatant({}, 99)
    const baseSwing = rollMeleeAttack(baseline, target, itemsData)
    const setSwing = rollMeleeAttack(setEquipped, target, itemsData)
    expect(setSwing.attackRoll).toBe(Math.floor(baseSwing.attackRoll * 1.3))
    expect(setSwing.maxHit).toBe(Math.floor(baseSwing.maxHit * 1.15))
  })

  it('full Shardglass set + Faerdhinen Warbow raises ranged accuracy and max hit by 30%/15%', () => {
    const baseline = combatant({ weapon: { itemId: 'bow_of_faerdhinen' } }, 1)
    const setEquipped = combatant(fullSetWithFaerdhinen, 2)
    const target = combatant({}, 99)
    const baseSwing = rollRangedAttack(baseline, target, itemsData)
    const setSwing = rollRangedAttack(setEquipped, target, itemsData)
    expect(setSwing.attackRoll).toBe(Math.floor(baseSwing.attackRoll * 1.3))
    expect(setSwing.maxHit).toBe(Math.floor(baseSwing.maxHit * 1.15))
  })

  it('full Shardglass set + Shardglass Bow raises ranged accuracy by 30%', () => {
    const baseline = combatant({ weapon: { itemId: 'shardglass_bow' } }, 1)
    const setEquipped = combatant(fullSetWithShardglassBow, 2)
    const target = combatant({}, 99)
    const baseSwing = rollRangedAttack(baseline, target, itemsData)
    const setSwing = rollRangedAttack(setEquipped, target, itemsData)
    expect(setSwing.attackRoll).toBe(Math.floor(baseSwing.attackRoll * 1.3))
  })

  it('grants no bonus when the armour is worn with an unrelated weapon', () => {
    const unrelated = combatant({ ...armour, weapon: { itemId: 'runeforged_scimitar' } }, 1)
    const baseline = combatant({ weapon: { itemId: 'runeforged_scimitar' } }, 2)
    const target = combatant({}, 99)
    expect(rollMeleeAttack(unrelated, target, itemsData).attackRoll).toBe(rollMeleeAttack(baseline, target, itemsData).attackRoll)
  })
})
