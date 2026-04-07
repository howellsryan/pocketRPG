import { TICK_DURATION } from '../utils/constants.js'

let tickInterval = null
let tickCount = 0
let listeners = []
let paused = false

/**
 * Register a tick listener. Called every game tick with the current tick count.
 * Returns an unsubscribe function.
 */
export function onTick(callback) {
  listeners.push(callback)
  return () => {
    listeners = listeners.filter(l => l !== callback)
  }
}

/**
 * Start the tick loop
 */
export function startTicks() {
  if (tickInterval) return
  tickInterval = setInterval(() => {
    if (paused) return
    tickCount++
    for (const listener of listeners) {
      try {
        listener(tickCount)
      } catch (e) {
        console.error('Tick listener error:', e)
      }
    }
  }, TICK_DURATION)
}

/**
 * Stop the tick loop
 */
export function stopTicks() {
  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = null
  }
}

/**
 * Pause/resume ticks (for background tab handling)
 */
export function pauseTicks() { paused = true }
export function resumeTicks() { paused = false }

/**
 * Get current tick count
 */
export function getTickCount() { return tickCount }

/**
 * Reset tick count (for new game)
 */
export function resetTicks() { tickCount = 0 }
