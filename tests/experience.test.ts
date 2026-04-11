import { describe, it, expect } from 'vitest'
import { getXPForLevel, getLevelFromXP, getXPToNextLevel, getLevelProgress, clampXP, XP_TABLE } from '../src/engine/experience.js'

const MAX_LEVEL = 99
const MAX_XP = 200_000_000

describe('Experience System', () => {
  describe('getXPForLevel', () => {
    it('should return 0 XP for level 1', () => {
      expect(getXPForLevel(1)).toBe(0)
    })

    it('should return increasing XP for each level', () => {
      const level5 = getXPForLevel(5)
      const level10 = getXPForLevel(10)
      const level50 = getXPForLevel(50)
      const level99 = getXPForLevel(99)

      expect(level5).toBeGreaterThan(0)
      expect(level10).toBeGreaterThan(level5)
      expect(level50).toBeGreaterThan(level10)
      expect(level99).toBeGreaterThan(level50)
    })

    it('should handle out-of-bounds levels', () => {
      expect(getXPForLevel(0)).toBe(0)
      expect(getXPForLevel(-5)).toBe(0)
      expect(getXPForLevel(100)).toBe(XP_TABLE[MAX_LEVEL])
      expect(getXPForLevel(999)).toBe(XP_TABLE[MAX_LEVEL])
    })

    it('should return MAX_XP at level 99', () => {
      const xpAt99 = getXPForLevel(99)
      expect(xpAt99).toBeLessThanOrEqual(MAX_XP)
    })

    it('should return XP_TABLE values for all valid levels', () => {
      for (let level = 1; level <= MAX_LEVEL; level++) {
        expect(getXPForLevel(level)).toBe(XP_TABLE[level])
      }
    })
  })

  describe('getLevelFromXP', () => {
    it('should return level 1 for 0 XP', () => {
      expect(getLevelFromXP(0)).toBe(1)
    })

    it('should return level 1 for negative XP', () => {
      expect(getLevelFromXP(-100)).toBe(1)
    })

    it('should return correct levels for known XP thresholds', () => {
      const level5XP = getXPForLevel(5)
      const level10XP = getXPForLevel(10)
      const level50XP = getXPForLevel(50)

      expect(getLevelFromXP(level5XP)).toBe(5)
      expect(getLevelFromXP(level10XP)).toBe(10)
      expect(getLevelFromXP(level50XP)).toBe(50)
    })

    it('should return level 99 for XP >= level 99 threshold', () => {
      const level99XP = getXPForLevel(99)
      expect(getLevelFromXP(level99XP)).toBe(99)
      expect(getLevelFromXP(level99XP + 1000)).toBe(99)
      expect(getLevelFromXP(MAX_XP)).toBe(99)
    })

    it('should handle XP between level thresholds', () => {
      const level10XP = getXPForLevel(10)
      const level11XP = getXPForLevel(11)
      const midpointXP = Math.floor((level10XP + level11XP) / 2)

      // Should be on level 10
      expect(getLevelFromXP(midpointXP)).toBe(10)
    })

    it('should use binary search correctly for all levels', () => {
      for (let level = 1; level <= MAX_LEVEL; level++) {
        const xp = getXPForLevel(level)
        expect(getLevelFromXP(xp)).toBe(level)
      }
    })
  })

  describe('getXPToNextLevel', () => {
    it('should return positive XP for levels below 99', () => {
      expect(getXPToNextLevel(0)).toBeGreaterThan(0)
      expect(getXPToNextLevel(getXPForLevel(50))).toBeGreaterThan(0)
    })

    it('should return 0 XP for level 99', () => {
      const level99XP = getXPForLevel(99)
      expect(getXPToNextLevel(level99XP)).toBe(0)
    })

    it('should decrease as you gain XP within a level', () => {
      const level10XP = getXPForLevel(10)
      const level11XP = getXPForLevel(11)
      const quarterXP = level10XP + Math.floor((level11XP - level10XP) / 4)

      const remaining1 = getXPToNextLevel(level10XP)
      const remaining2 = getXPToNextLevel(quarterXP)

      expect(remaining2).toBeLessThan(remaining1)
    })

    it('should equal XP difference between levels at start of level', () => {
      const level5XP = getXPForLevel(5)
      const level6XP = getXPForLevel(6)
      const expectedDiff = level6XP - level5XP

      expect(getXPToNextLevel(level5XP)).toBe(expectedDiff)
    })
  })

  describe('getLevelProgress', () => {
    it('should return 0 for start of level', () => {
      const level10XP = getXPForLevel(10)
      expect(getLevelProgress(level10XP)).toBe(0)
    })

    it('should return 1 for level 99', () => {
      const level99XP = getXPForLevel(99)
      expect(getLevelProgress(level99XP)).toBe(1)
    })

    it('should return value between 0 and 1 during level', () => {
      const level10XP = getXPForLevel(10)
      const level11XP = getXPForLevel(11)
      const midpointXP = Math.floor((level10XP + level11XP) / 2)

      const progress = getLevelProgress(midpointXP)
      expect(progress).toBeGreaterThan(0)
      expect(progress).toBeLessThan(1)
      expect(progress).toBeCloseTo(0.5, 1) // approximately 50% through
    })

    it('should increase as you gain XP', () => {
      const level20XP = getXPForLevel(20)
      const level21XP = getXPForLevel(21)
      const quarter = level20XP + Math.floor((level21XP - level20XP) / 4)
      const half = level20XP + Math.floor((level21XP - level20XP) / 2)

      expect(getLevelProgress(quarter)).toBeLessThan(getLevelProgress(half))
    })
  })

  describe('clampXP', () => {
    it('should return XP unchanged if below max', () => {
      expect(clampXP(100)).toBe(100)
      expect(clampXP(10_000_000)).toBe(10_000_000)
    })

    it('should clamp XP to MAX_XP', () => {
      expect(clampXP(MAX_XP + 1)).toBe(MAX_XP)
      expect(clampXP(MAX_XP * 2)).toBe(MAX_XP)
    })

    it('should return MAX_XP for exactly MAX_XP', () => {
      expect(clampXP(MAX_XP)).toBe(MAX_XP)
    })

    it('should handle negative XP', () => {
      expect(clampXP(-100)).toBe(-100)
    })
  })

  describe('XP_TABLE consistency', () => {
    it('should have 100 entries (1-99 levels)', () => {
      expect(XP_TABLE.length).toBe(100)
    })

    it('should have strictly increasing values', () => {
      for (let i = 1; i < XP_TABLE.length - 1; i++) {
        expect(XP_TABLE[i]).toBeLessThan(XP_TABLE[i + 1])
      }
    })

    it('should have all integers (no decimals)', () => {
      for (let i = 1; i < XP_TABLE.length; i++) {
        expect(Number.isInteger(XP_TABLE[i])).toBe(true)
      }
    })
  })
})
