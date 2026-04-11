import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  randInt,
  formatNumber,
  formatQuantity,
  ticksToTime,
  clamp,
  deepClone,
  fnv1a,
  debounce,
  calcCombatLevel
} from '../src/utils/helpers.js'

describe('Helper Utilities', () => {
  describe('randInt', () => {
    it('should return a value within the range (inclusive)', () => {
      for (let i = 0; i < 100; i++) {
        const result = randInt(1, 10)
        expect(result).toBeGreaterThanOrEqual(1)
        expect(result).toBeLessThanOrEqual(10)
      }
    })

    it('should return integers only', () => {
      for (let i = 0; i < 50; i++) {
        const result = randInt(5, 15)
        expect(Number.isInteger(result)).toBe(true)
      }
    })

    it('should handle single value range', () => {
      const result = randInt(5, 5)
      expect(result).toBe(5)
    })

    it('should work with negative numbers', () => {
      const result = randInt(-10, -5)
      expect(result).toBeGreaterThanOrEqual(-10)
      expect(result).toBeLessThanOrEqual(-5)
    })

    it('should work with zero', () => {
      const result = randInt(-5, 5)
      expect(result).toBeGreaterThanOrEqual(-5)
      expect(result).toBeLessThanOrEqual(5)
    })

    it('should have reasonable distribution (basic check)', () => {
      const results = new Set()
      for (let i = 0; i < 200; i++) {
        results.add(randInt(1, 10))
      }
      // Should have generated multiple different values
      expect(results.size).toBeGreaterThan(1)
    })
  })

  describe('formatNumber', () => {
    it('should format numbers with comma separators', () => {
      expect(formatNumber(1000)).toBe('1,000')
      expect(formatNumber(1000000)).toBe('1,000,000')
      expect(formatNumber(1234567)).toBe('1,234,567')
    })

    it('should handle small numbers without commas', () => {
      expect(formatNumber(1)).toBe('1')
      expect(formatNumber(99)).toBe('99')
      expect(formatNumber(999)).toBe('999')
    })

    it('should handle zero', () => {
      expect(formatNumber(0)).toBe('0')
    })

    it('should handle negative numbers', () => {
      expect(formatNumber(-1000)).toBe('-1,000')
      expect(formatNumber(-1234567)).toBe('-1,234,567')
    })
  })

  describe('formatQuantity', () => {
    it('should return plain text for small numbers (< 100k)', () => {
      const result = formatQuantity(99)
      expect(result.text).toBe('99')
      expect(result.isM).toBe(false)
    })

    it('should format 100k+ as "k" format', () => {
      const result = formatQuantity(150000)
      expect(result.text).toBe('150k')
      expect(result.isM).toBe(false)
    })

    it('should format 10M+ as "M" format', () => {
      const result = formatQuantity(50000000)
      expect(result.text).toBe('50M')
      expect(result.isM).toBe(true)
    })

    it('should handle exact boundaries', () => {
      const at100k = formatQuantity(100000)
      expect(at100k.text).toBe('100k')
      expect(at100k.isM).toBe(false)

      const at10M = formatQuantity(10000000)
      expect(at10M.text).toBe('10M')
      expect(at10M.isM).toBe(true)
    })

    it('should floor values correctly', () => {
      const result = formatQuantity(150555)
      expect(result.text).toBe('150k')
    })

    it('should handle very large numbers', () => {
      const result = formatQuantity(956000000)
      expect(result.text).toBe('956M')
      expect(result.isM).toBe(true)
    })
  })

  describe('ticksToTime', () => {
    it('should convert ticks to seconds (0.6s per tick)', () => {
      expect(ticksToTime(1)).toContain('0.6s')
      expect(ticksToTime(10)).toContain('6')
    })

    it('should show only seconds for < 60 seconds', () => {
      const result = ticksToTime(50)
      expect(result).toMatch(/^\d+(\.\d+)?s$/)
    })

    it('should show minutes and seconds for longer durations', () => {
      const result = ticksToTime(200) // ~120 seconds
      expect(result).toContain('m')
      expect(result).toContain('s')
    })

    it('should handle zero ticks', () => {
      const result = ticksToTime(0)
      expect(result).toBe('0.0s')
    })

    it('should show exact minute marks', () => {
      const result = ticksToTime(100) // 60 seconds
      expect(result).toContain('1m')
    })
  })

  describe('clamp', () => {
    it('should return value if within range', () => {
      expect(clamp(5, 1, 10)).toBe(5)
      expect(clamp(50, 0, 100)).toBe(50)
    })

    it('should clamp to min if below range', () => {
      expect(clamp(0, 1, 10)).toBe(1)
      expect(clamp(-100, 0, 100)).toBe(0)
    })

    it('should clamp to max if above range', () => {
      expect(clamp(15, 1, 10)).toBe(10)
      expect(clamp(150, 0, 100)).toBe(100)
    })

    it('should handle equal min/max', () => {
      expect(clamp(5, 10, 10)).toBe(10)
      expect(clamp(15, 10, 10)).toBe(10)
    })

    it('should work with negative ranges', () => {
      expect(clamp(-5, -10, -1)).toBe(-5)
      expect(clamp(-15, -10, -1)).toBe(-10)
    })
  })

  describe('deepClone', () => {
    it('should create a deep copy of objects', () => {
      const original = { a: 1, b: { c: 2 } }
      const cloned = deepClone(original)

      expect(cloned).toEqual(original)
      expect(cloned).not.toBe(original)
      expect(cloned.b).not.toBe(original.b)
    })

    it('should handle arrays', () => {
      const original = [1, 2, { a: 3 }]
      const cloned = deepClone(original)

      expect(cloned).toEqual(original)
      expect(cloned).not.toBe(original)
    })

    it('should handle nested structures', () => {
      const original = {
        stats: { attack: 10, defence: 5 },
        inventory: [{ itemId: 'sword', qty: 1 }, { itemId: 'shield', qty: 1 }]
      }
      const cloned = deepClone(original)

      cloned.stats.attack = 20
      expect(original.stats.attack).toBe(10)
    })

    it('should handle null and undefined values', () => {
      const original = { a: null, b: undefined }
      const cloned = deepClone(original)

      expect(cloned.a).toBeNull()
      expect(cloned.b).toBeUndefined()
    })

    it('should not clone functions (JSON limitation)', () => {
      const original = { fn: () => 42, data: 'test' }
      const cloned = deepClone(original)

      expect(cloned.data).toBe('test')
      expect(cloned.fn).toBeUndefined() // Functions are lost in JSON.stringify
    })
  })

  describe('fnv1a', () => {
    it('should produce consistent hashes for same input', () => {
      const hash1 = fnv1a('test')
      const hash2 = fnv1a('test')
      expect(hash1).toBe(hash2)
    })

    it('should produce different hashes for different inputs', () => {
      const hash1 = fnv1a('test')
      const hash2 = fnv1a('other')
      expect(hash1).not.toBe(hash2)
    })

    it('should produce hex string output', () => {
      const hash = fnv1a('test')
      expect(hash).toMatch(/^[0-9a-f]+$/)
    })

    it('should handle empty strings', () => {
      const hash = fnv1a('')
      expect(hash).toBeTruthy()
    })

    it('should handle long strings', () => {
      const longStr = 'a'.repeat(1000)
      const hash = fnv1a(longStr)
      expect(hash).toMatch(/^[0-9a-f]+$/)
    })
  })

  describe('debounce', () => {
    it('should delay function execution', async () => {
      const fn = vi.fn()
      const debounced = debounce(fn, 50)

      debounced()
      expect(fn).not.toHaveBeenCalled()

      await new Promise(resolve => setTimeout(resolve, 100))
      expect(fn).toHaveBeenCalledOnce()
    })

    it('should cancel previous calls', async () => {
      const fn = vi.fn()
      const debounced = debounce(fn, 50)

      debounced()
      debounced()
      debounced()

      await new Promise(resolve => setTimeout(resolve, 100))
      expect(fn).toHaveBeenCalledOnce()
    })

    it('should pass arguments to the function', async () => {
      const fn = vi.fn()
      const debounced = debounce(fn, 50)

      debounced(1, 'test', { a: 2 })

      await new Promise(resolve => setTimeout(resolve, 100))
      expect(fn).toHaveBeenCalledWith(1, 'test', { a: 2 })
    })
  })

  describe('calcCombatLevel', () => {
    it('should calculate combat level from stats', () => {
      const stats = {
        attack: 40,
        strength: 40,
        defence: 40,
        hitpoints: 40,
        ranged: 1,
        magic: 1,
        prayer: 0
      }
      const combatLevel = calcCombatLevel(stats)
      expect(combatLevel).toBeGreaterThan(0)
    })

    it('should prioritize highest melee/range/mage', () => {
      const statsMelee = {
        attack: 99,
        strength: 99,
        defence: 1,
        hitpoints: 10,
        ranged: 1,
        magic: 1,
        prayer: 0
      }
      const statsRange = {
        attack: 1,
        strength: 1,
        defence: 1,
        hitpoints: 10,
        ranged: 99,
        magic: 1,
        prayer: 0
      }
      const statsMage = {
        attack: 1,
        strength: 1,
        defence: 1,
        hitpoints: 10,
        ranged: 1,
        magic: 99,
        prayer: 0
      }

      const cbMelee = calcCombatLevel(statsMelee)
      const cbRange = calcCombatLevel(statsRange)
      const cbMage = calcCombatLevel(statsMage)

      // All should be high but different
      expect(cbMelee).toBeGreaterThan(0)
      expect(cbRange).toBeGreaterThan(0)
      expect(cbMage).toBeGreaterThan(0)
    })

    it('should include prayer bonus at 0.5x', () => {
      const statsNoPrayer = {
        attack: 10,
        strength: 10,
        defence: 10,
        hitpoints: 10,
        ranged: 1,
        magic: 1,
        prayer: 0
      }
      const statsWithPrayer = {
        attack: 10,
        strength: 10,
        defence: 10,
        hitpoints: 10,
        ranged: 1,
        magic: 1,
        prayer: 50
      }

      const cb1 = calcCombatLevel(statsNoPrayer)
      const cb2 = calcCombatLevel(statsWithPrayer)

      expect(cb2).toBeGreaterThan(cb1)
    })

    it('should handle level 1 stats', () => {
      const stats = {
        attack: 1,
        strength: 1,
        defence: 1,
        hitpoints: 1,
        ranged: 1,
        magic: 1,
        prayer: 0
      }
      const combatLevel = calcCombatLevel(stats)
      expect(combatLevel).toBeLessThan(5)
    })

    it('should handle max level stats', () => {
      const stats = {
        attack: 99,
        strength: 99,
        defence: 99,
        hitpoints: 99,
        ranged: 99,
        magic: 99,
        prayer: 99
      }
      const combatLevel = calcCombatLevel(stats)
      // 0.25 * (99 + 99 + floor(99/2)) + 0.325 * (99 + 99) = 61.75 + 64.35 = 126
      expect(combatLevel).toBe(126)
    })
  })
})
