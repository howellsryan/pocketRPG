import { describe, it, expect, beforeEach } from 'vitest'
import {
  getAgilityBankDelayMs,
  getAgilityBankDelayFromStats,
  formatBankDelay,
  createAgilityState,
  processAgilityTick,
  simulateIdleAgility
} from '../src/engine/agility.js'
import { getXPForLevel } from '../src/engine/experience.js'

const AGILITY_BANK_DELAY_LV1_MS = 5 * 60 * 1000 // 5 minutes
const AGILITY_BANK_DELAY_LV99_MS = 10 * 1000 // 10 seconds

describe('Agility System', () => {
  describe('getAgilityBankDelayMs', () => {
    it('should return 5 minutes (300000ms) at level 1', () => {
      const delay = getAgilityBankDelayMs(1)
      expect(delay).toBe(AGILITY_BANK_DELAY_LV1_MS)
    })

    it('should return 10 seconds (10000ms) at level 99', () => {
      const delay = getAgilityBankDelayMs(99)
      expect(delay).toBe(AGILITY_BANK_DELAY_LV99_MS)
    })

    it('should scale linearly from level 1 to 99', () => {
      const at1 = getAgilityBankDelayMs(1)
      const at50 = getAgilityBankDelayMs(50)
      const at99 = getAgilityBankDelayMs(99)

      // Should decrease as level increases
      expect(at1).toBeGreaterThan(at50)
      expect(at50).toBeGreaterThan(at99)
    })

    it('should handle levels below 1', () => {
      const delay = getAgilityBankDelayMs(0)
      expect(delay).toBe(AGILITY_BANK_DELAY_LV1_MS)
    })

    it('should handle levels above 99', () => {
      const delay = getAgilityBankDelayMs(100)
      expect(delay).toBe(AGILITY_BANK_DELAY_LV99_MS)
    })

    it('should return approximately 152500ms at level 50 (midpoint)', () => {
      const delay = getAgilityBankDelayMs(50)
      // Linear interpolation: 300000 + (50-1)/98 * (10000 - 300000)
      // Should be roughly halfway
      const expected = Math.round(AGILITY_BANK_DELAY_LV1_MS + (49 / 98) * (AGILITY_BANK_DELAY_LV99_MS - AGILITY_BANK_DELAY_LV1_MS))
      expect(delay).toBe(expected)
    })

    it('should return rounded milliseconds', () => {
      for (let level = 1; level <= 99; level++) {
        const delay = getAgilityBankDelayMs(level)
        expect(Number.isInteger(delay)).toBe(true)
      }
    })
  })

  describe('getAgilityBankDelayFromStats', () => {
    it('should use level 1 delay for zero XP', () => {
      const stats = { agility: { xp: 0 } }
      const delay = getAgilityBankDelayFromStats(stats)
      expect(delay).toBe(AGILITY_BANK_DELAY_LV1_MS)
    })

    it('should calculate delay from XP', () => {
      const level50XP = getXPForLevel(50)
      const stats = { agility: { xp: level50XP } }
      const delay = getAgilityBankDelayFromStats(stats)

      // Should match level 50 delay
      const expected = getAgilityBankDelayMs(50)
      expect(delay).toBe(expected)
    })

    it('should handle missing agility XP gracefully', () => {
      const stats = {}
      const delay = getAgilityBankDelayFromStats(stats)
      expect(delay).toBe(AGILITY_BANK_DELAY_LV1_MS)
    })

    it('should handle null stats gracefully', () => {
      const delay = getAgilityBankDelayFromStats(null)
      expect(delay).toBe(AGILITY_BANK_DELAY_LV1_MS)
    })

    it('should reach level 99 delay at max XP', () => {
      const level99XP = getXPForLevel(99)
      const stats = { agility: { xp: level99XP } }
      const delay = getAgilityBankDelayFromStats(stats)

      expect(delay).toBe(AGILITY_BANK_DELAY_LV99_MS)
    })
  })

  describe('formatBankDelay', () => {
    it('should format seconds only for short durations', () => {
      const result = formatBankDelay(30000) // 30 seconds
      expect(result).toMatch(/^\d+s$/)
      expect(result).toBe('30s')
    })

    it('should format minutes and seconds for longer durations', () => {
      const result = formatBankDelay(90000) // 1 minute 30 seconds
      expect(result).toContain('m')
      expect(result).toContain('s')
      expect(result).toBe('1m 30s')
    })

    it('should format minutes only when no remainder', () => {
      const result = formatBankDelay(120000) // 2 minutes
      expect(result).toBe('2m')
      expect(result).not.toContain('s')
    })

    it('should handle level 1 delay (5 minutes)', () => {
      const result = formatBankDelay(AGILITY_BANK_DELAY_LV1_MS)
      expect(result).toBe('5m')
    })

    it('should handle level 99 delay (10 seconds)', () => {
      const result = formatBankDelay(AGILITY_BANK_DELAY_LV99_MS)
      expect(result).toBe('10s')
    })

    it('should round milliseconds to nearest second', () => {
      const result1 = formatBankDelay(1400) // 1.4 seconds → rounds to 1s
      const result2 = formatBankDelay(1600) // 1.6 seconds → rounds to 2s

      expect(result1).toBe('1s')
      expect(result2).toBe('2s')
    })

    it('should handle zero milliseconds', () => {
      const result = formatBankDelay(0)
      expect(result).toBe('0s')
    })

    it('should handle very large durations', () => {
      const result = formatBankDelay(3661000) // 61 minutes 1 second
      expect(result).toContain('m')
      expect(result).toContain('s')
    })
  })

  describe('createAgilityState', () => {
    it('should create initial agility state from action', () => {
      const action = { name: 'Rooftop', ticks: 100, xp: 200, coinReward: 50 }
      const state = createAgilityState(action)

      expect(state.active).toBe(true)
      expect(state.action).toBe(action)
      expect(state.ticksRemaining).toBe(100)
      expect(state.tickCount).toBe(0)
    })

    it('should store action reference', () => {
      const action = { name: 'Agility Course', ticks: 50 }
      const state = createAgilityState(action)

      expect(state.action).toBe(action)
      expect(state.action.name).toBe('Agility Course')
    })

    it('should set ticksRemaining equal to action ticks', () => {
      const action = { name: 'Test', ticks: 250 }
      const state = createAgilityState(action)

      expect(state.ticksRemaining).toBe(250)
    })
  })

  describe('processAgilityTick', () => {
    it('should increment tick count on each call', () => {
      const action = { name: 'Test', ticks: 5, xp: 100 }
      let state = createAgilityState(action)

      expect(state.tickCount).toBe(0)

      const result1 = processAgilityTick(state)
      expect(result1.agilityState.tickCount).toBe(1)

      state = result1.agilityState
      const result2 = processAgilityTick(state)
      expect(result2.agilityState.tickCount).toBe(2)
    })

    it('should decrement ticksRemaining', () => {
      const action = { name: 'Test', ticks: 5, xp: 100 }
      const state = createAgilityState(action)

      const result = processAgilityTick(state)
      expect(result.agilityState.ticksRemaining).toBe(4)
    })

    it('should emit courseComplete event when lap finishes', () => {
      const action = { name: 'Rooftop', ticks: 3, xp: 500, coinReward: 100 }
      let state = createAgilityState(action)

      // Process 2 ticks
      state = processAgilityTick(state).agilityState
      state = processAgilityTick(state).agilityState

      // Third tick completes the lap
      const result = processAgilityTick(state)
      expect(result.events.length).toBe(1)
      expect(result.events[0].type).toBe('courseComplete')
      expect(result.events[0].xp).toBe(500)
      expect(result.events[0].coinReward).toBe(100)
      expect(result.events[0].actionName).toBe('Rooftop')
    })

    it('should reset for next lap after completion', () => {
      const action = { name: 'Test', ticks: 2, xp: 100 }
      let state = createAgilityState(action)

      state = processAgilityTick(state).agilityState
      state = processAgilityTick(state).agilityState

      expect(state.ticksRemaining).toBe(2) // Reset to action.ticks
    })

    it('should handle actions without coinReward', () => {
      const action = { name: 'Test', ticks: 1, xp: 100 }
      const state = createAgilityState(action)

      const result = processAgilityTick(state)
      expect(result.events[0].coinReward).toBe(0)
    })

    it('should not mutate original state', () => {
      const action = { name: 'Test', ticks: 5, xp: 100 }
      const state = createAgilityState(action)

      const result = processAgilityTick(state)
      expect(result.agilityState).not.toBe(state)
    })
  })

  describe('simulateIdleAgility', () => {
    it('should return null for missing task', () => {
      const result = simulateIdleAgility(null, 1000)
      expect(result).toBeNull()
    })

    it('should return null for task without action', () => {
      const task = {} // No action property
      const result = simulateIdleAgility(task, 1000)
      expect(result).toBeNull()
    })

    it('should return null if elapsed time is too short', () => {
      const task = { action: { name: 'Test', ticks: 100, xp: 200 } }
      const result = simulateIdleAgility(task, 100) // Only 100ms, need 600ms per tick
      expect(result).toBeNull()
    })

    it('should calculate laps completed', () => {
      const task = { action: { name: 'Test', ticks: 10, xp: 100 } }
      const TICK_MS = 600
      const elapsedMs = TICK_MS * 10 * 5 // 5 laps worth of ticks

      const result = simulateIdleAgility(task, elapsedMs)
      expect(result.laps).toBe(5)
    })

    it('should return XP gained', () => {
      const task = { action: { name: 'Test', ticks: 10, xp: 150 } }
      const TICK_MS = 600
      const elapsedMs = TICK_MS * 10 * 3 // 3 laps

      const result = simulateIdleAgility(task, elapsedMs)
      expect(result.xpGained.agility).toBe(150 * 3)
    })

    it('should return coins gained', () => {
      const task = { action: { name: 'Test', ticks: 5, xp: 100, coinReward: 50 } }
      const TICK_MS = 600
      const elapsedMs = TICK_MS * 5 * 4 // 4 laps

      const result = simulateIdleAgility(task, elapsedMs)
      expect(result.coinsGained).toBe(50 * 4)
    })

    it('should handle actions without coinReward', () => {
      const task = { action: { name: 'Test', ticks: 5, xp: 100 } }
      const TICK_MS = 600
      const elapsedMs = TICK_MS * 5 * 2

      const result = simulateIdleAgility(task, elapsedMs)
      expect(result.coinsGained).toBe(0)
    })

    it('should return skill and action name', () => {
      const task = { action: { name: 'Rooftop Course', ticks: 10, xp: 250 } }
      const TICK_MS = 600
      const elapsedMs = TICK_MS * 10 * 2

      const result = simulateIdleAgility(task, elapsedMs)
      expect(result.skill).toBe('agility')
      expect(result.actionName).toBe('Rooftop Course')
    })

    it('should handle partial lap (not counted)', () => {
      const task = { action: { name: 'Test', ticks: 10, xp: 100 } }
      const TICK_MS = 600
      const elapsedMs = TICK_MS * 15 // 1.5 laps, only 1 lap counts

      const result = simulateIdleAgility(task, elapsedMs)
      expect(result.laps).toBe(1)
      expect(result.xpGained.agility).toBe(100)
    })

    it('should handle very long idle periods', () => {
      const task = { action: { name: 'Test', ticks: 5, xp: 50 } }
      const TICK_MS = 600
      const elapsedMs = TICK_MS * 5 * 1000 // 1000 laps

      const result = simulateIdleAgility(task, elapsedMs)
      expect(result.laps).toBe(1000)
      expect(result.xpGained.agility).toBe(50000)
    })
  })

  describe('Integration - Banking Workflow', () => {
    it('should compute realistic delays', () => {
      // Level 1: 5 minutes
      const delayLv1 = getAgilityBankDelayMs(1)
      expect(delayLv1).toBe(5 * 60 * 1000)

      // Level 25: ~3.5 minutes
      const delayLv25 = getAgilityBankDelayMs(25)
      expect(delayLv25).toBeLessThan(delayLv1)
      expect(delayLv25).toBeGreaterThan(AGILITY_BANK_DELAY_LV99_MS)

      // Level 99: 10 seconds
      const delayLv99 = getAgilityBankDelayMs(99)
      expect(delayLv99).toBe(10 * 1000)
    })

    it('should format delays for UI display', () => {
      const lvl1 = formatBankDelay(getAgilityBankDelayMs(1))
      const lvl50 = formatBankDelay(getAgilityBankDelayMs(50))
      const lvl99 = formatBankDelay(getAgilityBankDelayMs(99))

      expect(lvl1).toBe('5m')
      expect(lvl99).toBe('10s')
      expect(lvl50).toContain('m') // Should show minutes
    })
  })
})
