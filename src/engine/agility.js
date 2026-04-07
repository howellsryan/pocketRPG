/**
 * Agility Engine — pure logic for agility courses and banking delay.
 * No UI imports.
 */

import { getLevelFromXP } from './experience.js'
import { AGILITY_BANK_DELAY_LV1_MS, AGILITY_BANK_DELAY_LV99_MS } from '../utils/constants.js'

/**
 * Get the agility-scaled bank delay in milliseconds.
 * Level 1 → 5 minutes, Level 99 → 10 seconds. Linear interpolation.
 */
export function getAgilityBankDelayMs(agilityLevel) {
  const lvl = Math.max(1, Math.min(99, agilityLevel))
  // Linear interpolation: delay = LV1_MS + (lvl - 1) / 98 * (LV99_MS - LV1_MS)
  const t = (lvl - 1) / 98
  return Math.round(AGILITY_BANK_DELAY_LV1_MS + t * (AGILITY_BANK_DELAY_LV99_MS - AGILITY_BANK_DELAY_LV1_MS))
}

/**
 * Get the agility bank delay from a stats object (which has xp values).
 */
export function getAgilityBankDelayFromStats(stats) {
  const agilityXP = stats?.agility?.xp || 0
  const agilityLevel = getLevelFromXP(agilityXP)
  return getAgilityBankDelayMs(agilityLevel)
}

/**
 * Format the bank delay into a human-readable string (e.g. "2m 30s", "45s").
 */
export function formatBankDelay(ms) {
  const totalSeconds = Math.round(ms / 1000)
  const mins = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  if (mins > 0 && secs > 0) return `${mins}m ${secs}s`
  if (mins > 0) return `${mins}m`
  return `${secs}s`
}

/**
 * Create an agility state object for a course run.
 */
export function createAgilityState(action) {
  return {
    active: true,
    action,
    ticksRemaining: action.ticks,
    tickCount: 0
  }
}

/**
 * Process one tick of agility training.
 * Returns { agilityState, events[] }
 * events: { type: 'courseComplete', xp, coinReward, actionName }
 */
export function processAgilityTick(agilityState) {
  const state = { ...agilityState }
  const events = []
  state.tickCount++
  state.ticksRemaining--

  if (state.ticksRemaining <= 0) {
    events.push({
      type: 'courseComplete',
      xp: state.action.xp,
      coinReward: state.action.coinReward || 0,
      actionName: state.action.name
    })
    // Reset for next lap
    state.ticksRemaining = state.action.ticks
  }

  return { agilityState: state, events }
}

/**
 * Simulate idle agility training.
 * Returns { xpGained, coinsGained, laps, skill, actionName }
 */
export function simulateIdleAgility(task, elapsedMs) {
  if (!task || !task.action) return null

  const TICK_MS = 600
  const totalTicks = Math.floor(elapsedMs / TICK_MS)
  const laps = Math.floor(totalTicks / task.action.ticks)

  if (laps <= 0) return null

  const xpGained = { agility: task.action.xp * laps }
  const coinsGained = (task.action.coinReward || 0) * laps

  return { xpGained, coinsGained, laps, skill: 'agility', actionName: task.action.name }
}
