import { describe, expect, it } from 'vitest'
import {
  hasFullShardglassSet,
  getCombatSetMultipliers,
} from '../src/engine/combatSetBonuses.js'
import { rollMeleeAttack, rollRangedAttack } from '../src/engine/combatPrimitives.js'
import { buildPlayerCombatant } from '../src/engine/combatant.js'
import itemsData from '../src/data/items.json'

const fullSetWithSaeldor = {
  head: { itemId: 'shardglass_helmet' },
  body: { itemId: 'shardglass_plate_body' },
  legs: { itemId: 'shardglass_platelegs' },
  weapon: { itemId: 'blade_of_saeldor' },
}

const fullSetWithFaerdhinen = {
  ...fullSetWithSaeldor,
  weapon: { itemId: 'bow_of_faerdhinen' },
}

describe('hasFullShardglassSet', () => {
  it('returns true with all 3 armour pieces + the Saeldor Warblade', () => {
    expect(hasFullShardglassSet(fullSetWithSaeldor)).toBe(true)
  })

  it('returns true with all 3 armour pieces + the Faerdhinen Warbow', () => {
    expect(hasFullShardglassSet(fullSetWithFaerdhinen)).toBe(true)
  })

  it('returns false when any one armour slot is missing', () => {
    for (const slot of ['head', 'body', 'legs'] as const) {
      const partial = { ...fullSetWithSaeldor, [slot]: null }
      expect(hasFullShardglassSet(partial)).toBe(false)
    }
  })

  it('returns false with the full armour set but no qualifying weapon', () => {
    expect(hasFullShardglassSet({ ...fullSetWithSaeldor, weapon: null })).toBe(false)
    expect(hasFullShardglassSet({ ...fullSetWithSaeldor, weapon: { itemId: 'shardglass_bow' } })).toBe(false)
  })

  it('returns false for empty equipment', () => {
    expect(hasFullShardglassSet({})).toBe(false)
    expect(hasFullShardglassSet(null as any)).toBe(false)
  })
})

describe('getCombatSetMultipliers accuracyFlat (Shardglass)', () => {
  it('grants +30 accuracyFlat with the full set + a qualifying weapon', () => {
    expect(getCombatSetMultipliers(fullSetWithSaeldor).accuracyFlat).toBe(30)
    expect(getCombatSetMultipliers(fullSetWithFaerdhinen).accuracyFlat).toBe(30)
  })

  it('grants no accuracyFlat without a qualifying weapon', () => {
    expect(getCombatSetMultipliers({ ...fullSetWithSaeldor, weapon: null }).accuracyFlat).toBe(0)
  })

  it('grants no accuracyFlat with a qualifying weapon but partial armour', () => {
    expect(getCombatSetMultipliers({ ...fullSetWithSaeldor, legs: null }).accuracyFlat).toBe(0)
  })
})

// Integration: the +30 flat accuracy should flow through both the melee and
// ranged rollers as a bonus added before the maxAttackRoll formula, matching
// the real Shardglass helmet/body/legs + Saeldor/Faerdhinen items.
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

  it('full Shardglass set + Saeldor Warblade raises melee attackRoll vs the same weapon alone', () => {
    const baseline = combatant({ weapon: { itemId: 'blade_of_saeldor' } }, 1)
    const setEquipped = combatant(fullSetWithSaeldor, 2)
    const target = combatant({}, 99)
    const baseSwing = rollMeleeAttack(baseline, target, itemsData)
    const setSwing = rollMeleeAttack(setEquipped, target, itemsData)
    expect(setSwing.attackRoll).toBeGreaterThan(baseSwing.attackRoll)
    expect(setSwing.maxHit).toBe(baseSwing.maxHit)
  })

  it('full Shardglass set + Faerdhinen Warbow raises ranged attackRoll vs the same weapon alone', () => {
    const baseline = combatant({ weapon: { itemId: 'bow_of_faerdhinen' } }, 1)
    const setEquipped = combatant(fullSetWithFaerdhinen, 2)
    const target = combatant({}, 99)
    const baseSwing = rollRangedAttack(baseline, target, itemsData)
    const setSwing = rollRangedAttack(setEquipped, target, itemsData)
    expect(setSwing.attackRoll).toBeGreaterThan(baseSwing.attackRoll)
  })

  it('grants no accuracy bonus when the armour is worn with an unrelated weapon', () => {
    const unrelated = combatant({ ...fullSetWithSaeldor, weapon: { itemId: 'shardglass_bow' } }, 1)
    const baseline = combatant({ weapon: { itemId: 'shardglass_bow' } }, 2)
    const target = combatant({}, 99)
    expect(rollRangedAttack(unrelated, target, itemsData).attackRoll).toBe(rollRangedAttack(baseline, target, itemsData).attackRoll)
  })
})
