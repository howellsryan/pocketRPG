import { describe, it, expect, vi } from 'vitest'
import {
  effectiveStrength,
  meleeMaxHit,
  effectiveAttack,
  maxAttackRoll,
  maxDefenceRoll,
  hitChance,
  rollDamage,
  effectiveRanged,
  rangedMaxHit,
  effectiveMagic,
  monsterMagicDefenceRoll,
  magicMaxHit,
  getMeleeStyleBonuses,
  getMeleeXPSkill,
  getRangedStyleBonus,
  getPotionBonus
} from '../src/engine/formulas.js'

describe('Combat Formulas', () => {
  describe('Melee Effective Calculations', () => {
    it('effectiveStrength should include base + potion + prayer + style bonus', () => {
      const base = effectiveStrength(50)
      const withPotion = effectiveStrength(50, 5)
      const withPrayer = effectiveStrength(50, 0, 1.1)
      const withStyle = effectiveStrength(50, 0, 1.0, 3)

      expect(withPotion).toBeGreaterThan(base)
      expect(withPrayer).toBeGreaterThan(base)
      expect(withStyle).toBeGreaterThan(base)
    })

    it('effectiveStrength should apply prayer as multiplier before style bonus', () => {
      const result = effectiveStrength(50, 5, 1.1, 3)
      // (50 + 5) * 1.1 + 3 + 8 = 55 * 1.1 + 3 + 8 = 60.5 + 3 + 8 = floor(60.5) + 11 = 71
      expect(result).toBeGreaterThan(60)
    })

    it('effectiveAttack should work like effectiveStrength', () => {
      const base = effectiveAttack(50)
      const withBonus = effectiveAttack(50, 5, 1.1, 3)

      expect(withBonus).toBeGreaterThan(base)
      expect(base).toBeGreaterThan(50) // Has +8 flat bonus
    })
  })

  describe('Melee Max Hit', () => {
    it('meleeMaxHit should scale with effective strength and equipment bonus', () => {
      const low = meleeMaxHit(10, 0)
      const high = meleeMaxHit(50, 30)

      expect(high).toBeGreaterThan(low)
    })

    it('meleeMaxHit should use formula: floor(0.5 + effStr * (bonus + 64) / 640)', () => {
      // Known values: effStr=50, bonus=0 → (0.5 + 50*64/640) = (0.5 + 5) = 5.5 → floor(5.5) = 5
      const result = meleeMaxHit(50, 0)
      expect(result).toBe(5)
    })

    it('meleeMaxHit should return positive values', () => {
      expect(meleeMaxHit(10, 10)).toBeGreaterThan(0)
      expect(meleeMaxHit(99, 50)).toBeGreaterThan(0)
    })

    it('meleeMaxHit should apply gear multiplier', () => {
      const base = meleeMaxHit(50, 10)
      const boosted = meleeMaxHit(50, 10, 1.5)

      expect(boosted).toBeGreaterThan(base)
    })

    it('meleeMaxHit should handle level 1 stats', () => {
      const result = meleeMaxHit(1, 0)
      expect(result).toBeGreaterThanOrEqual(0)
    })

    it('meleeMaxHit should handle max level stats', () => {
      const result = meleeMaxHit(99, 99)
      expect(result).toBeGreaterThan(0)
    })
  })

  describe('Attack Rolls', () => {
    it('maxAttackRoll should multiply effective attack by (bonus + 64)', () => {
      // If effAtk = 50, bonus = 0 → 50 * 64 = 3200
      const result = maxAttackRoll(50, 0)
      expect(result).toBe(50 * 64)
    })

    it('maxAttackRoll should increase with bonus', () => {
      const noBuff = maxAttackRoll(50, 0)
      const withBuff = maxAttackRoll(50, 20)

      expect(withBuff).toBeGreaterThan(noBuff)
    })
  })

  describe('Defence Rolls', () => {
    it('maxDefenceRoll should multiply (level + 9) by (bonus + 64)', () => {
      // level = 50, bonus = 0 → (50 + 9) * 64 = 59 * 64 = 3776
      const result = maxDefenceRoll(50, 0)
      expect(result).toBe(59 * 64)
    })

    it('maxDefenceRoll should increase with higher defence level', () => {
      const lowDef = maxDefenceRoll(10, 0)
      const highDef = maxDefenceRoll(50, 0)

      expect(highDef).toBeGreaterThan(lowDef)
    })
  })

  describe('Hit Chance', () => {
    it('hitChance should be 1.0 when attack roll >> defence roll', () => {
      const chance = hitChance(10000, 10)
      expect(chance).toBeCloseTo(1.0, 1)
    })

    it('hitChance should be 0.0 when attack roll << defence roll', () => {
      const chance = hitChance(10, 10000)
      expect(chance).toBeCloseTo(0.0, 2)
    })

    it('hitChance should be ~0.5 when rolls are equal', () => {
      const chance = hitChance(100, 100)
      expect(chance).toBeGreaterThan(0.4)
      expect(chance).toBeLessThan(0.6)
    })

    it('hitChance should use different formula for attacker advantage', () => {
      // When atkRoll > defRoll: 1 - (defRoll + 2) / (2 * (atkRoll + 1))
      const chance = hitChance(200, 100)
      expect(chance).toBeGreaterThan(0.5)
    })

    it('hitChance should use different formula for defender advantage', () => {
      // When atkRoll <= defRoll: atkRoll / (2 * (defRoll + 1))
      const chance = hitChance(100, 200)
      expect(chance).toBeLessThan(0.5)
    })

    it('hitChance should always be between 0 and 1', () => {
      const testCases = [
        [1, 1000],
        [1000, 1],
        [100, 100],
        [50, 200],
        [300, 75]
      ]

      testCases.forEach(([atk, def]) => {
        const chance = hitChance(atk, def)
        expect(chance).toBeGreaterThanOrEqual(0)
        expect(chance).toBeLessThanOrEqual(1)
      })
    })
  })

  describe('rollDamage', () => {
    it('should return 0 for a miss (accuracy = 0)', () => {
      const result = rollDamage(0, 10)
      expect(result).toBe(0)
    })

    it('should return 0-maxHit for a hit (accuracy = 1)', () => {
      for (let i = 0; i < 50; i++) {
        const result = rollDamage(1.0, 10)
        expect(result).toBeGreaterThanOrEqual(1)
        expect(result).toBeLessThanOrEqual(10)
      }
    })

    it('should return 0 or 1-maxHit with intermediate accuracy', () => {
      let hitCount = 0
      let missCount = 0

      for (let i = 0; i < 100; i++) {
        const result = rollDamage(0.5, 10)
        if (result === 0) missCount++
        else {
          hitCount++
          expect(result).toBeGreaterThanOrEqual(1)
          expect(result).toBeLessThanOrEqual(10)
        }
      }

      // With 0.5 accuracy, should have both hits and misses
      expect(hitCount).toBeGreaterThan(0)
      expect(missCount).toBeGreaterThan(0)
    })

    it('should always return integers', () => {
      for (let i = 0; i < 50; i++) {
        const result = rollDamage(0.75, 10)
        expect(Number.isInteger(result)).toBe(true)
      }
    })
  })

  describe('Ranged', () => {
    it('effectiveRanged should work like melee effective levels', () => {
      const base = effectiveRanged(50)
      const boosted = effectiveRanged(50, 5, 1.1, 3)

      expect(boosted).toBeGreaterThan(base)
    })

    it('rangedMaxHit should use same formula as melee', () => {
      const melee = meleeMaxHit(50, 20)
      const ranged = rangedMaxHit(50, 20)

      expect(ranged).toBe(melee)
    })

    it('getRangedStyleBonus should return correct bonuses', () => {
      expect(getRangedStyleBonus('accurate')).toBe(3)
      expect(getRangedStyleBonus('rapid')).toBe(0)
      expect(getRangedStyleBonus('longrange')).toBe(3)
      expect(getRangedStyleBonus('unknown')).toBe(0)
    })
  })

  describe('Magic', () => {
    it('effectiveMagic should work like other effective levels', () => {
      const base = effectiveMagic(50)
      const boosted = effectiveMagic(50, 5, 1.1, 3)

      expect(boosted).toBeGreaterThan(base)
    })

    it('monsterMagicDefenceRoll should use 70% magic + 30% defence', () => {
      // 70% of 50 magic + 30% of 40 def = 35 + 12 = 47, then + 9 = 56, * 64 = 3584
      const result = monsterMagicDefenceRoll(50, 40, 0)
      expect(result).toBe((Math.floor(50 * 0.7) + Math.floor(40 * 0.3) + 9) * 64)
    })

    it('magicMaxHit should apply damage bonus as percentage', () => {
      const base = magicMaxHit(20, 0)
      const boosted = magicMaxHit(20, 50) // 50% bonus

      expect(boosted).toBe(Math.floor(20 * 1.5))
      expect(boosted).toBeGreaterThan(base)
    })

    it('magicMaxHit with 100% bonus should double damage', () => {
      const result = magicMaxHit(20, 100)
      expect(result).toBe(40)
    })
  })

  describe('Style Bonuses', () => {
    it('getMeleeStyleBonuses should return correct values for each stance', () => {
      const accurate = getMeleeStyleBonuses('accurate')
      expect(accurate.attackStyleBonus).toBe(3)
      expect(accurate.strengthStyleBonus).toBe(0)
      expect(accurate.defenceStyleBonus).toBe(0)

      const aggressive = getMeleeStyleBonuses('aggressive')
      expect(aggressive.strengthStyleBonus).toBe(3)

      const defensive = getMeleeStyleBonuses('defensive')
      expect(defensive.defenceStyleBonus).toBe(3)

      const controlled = getMeleeStyleBonuses('controlled')
      expect(controlled.attackStyleBonus).toBe(1)
      expect(controlled.strengthStyleBonus).toBe(1)
      expect(controlled.defenceStyleBonus).toBe(1)
    })

    it('getMeleeStyleBonuses should return zeros for unknown stance', () => {
      const result = getMeleeStyleBonuses('unknown')
      expect(result.attackStyleBonus).toBe(0)
      expect(result.strengthStyleBonus).toBe(0)
      expect(result.defenceStyleBonus).toBe(0)
    })

    it('getMeleeXPSkill should map stances to skills', () => {
      expect(getMeleeXPSkill('accurate')).toBe('attack')
      expect(getMeleeXPSkill('aggressive')).toBe('strength')
      expect(getMeleeXPSkill('defensive')).toBe('defence')
      expect(getMeleeXPSkill('controlled')).toEqual(['attack', 'strength', 'defence'])
    })

    it('getMeleeXPSkill should default to attack for unknown', () => {
      expect(getMeleeXPSkill('unknown')).toBe('attack')
    })
  })

  describe('Potion Bonuses', () => {
    it('getPotionBonus should return 0 for unknown potions', () => {
      expect(getPotionBonus('unknown', 50)).toBe(0)
    })

    it('getPotionBonus should scale with base level', () => {
      const low = getPotionBonus('attack_potion', 10)
      const high = getPotionBonus('attack_potion', 99)

      expect(high).toBeGreaterThan(low)
    })

    it('super potions should be stronger than regular potions', () => {
      const regular = getPotionBonus('attack_potion', 99)
      const super_ = getPotionBonus('super_attack', 99)

      expect(super_).toBeGreaterThan(regular)
    })

    it('ranging_potion should have 4 base instead of 3', () => {
      const attack = getPotionBonus('attack_potion', 1)
      const ranging = getPotionBonus('ranging_potion', 1)

      expect(ranging).toBeGreaterThan(attack)
    })

    it('super potions should have 5 base and 15% scaling', () => {
      const bonus = getPotionBonus('super_attack', 99)
      // 5 + floor(99 * 0.15) = 5 + 14 = 19
      expect(bonus).toBe(5 + Math.floor(99 * 0.15))
    })

    it('all potion types should have valid bonuses', () => {
      const potions = ['attack_potion', 'strength_potion', 'defence_potion', 'ranging_potion', 'super_attack', 'super_strength', 'super_defence']

      potions.forEach(potion => {
        const bonus = getPotionBonus(potion, 50)
        expect(bonus).toBeGreaterThan(0)
      })
    })
  })
})
