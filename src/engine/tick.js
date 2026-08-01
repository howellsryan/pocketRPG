import { TICK_DURATION } from '../utils/constants.js'

let tickInterval = null
let tickCount = 0
let listeners = []
let paused = false
const tickHolds = new Set()

// Key for the boss-skip confirmation hold (see holdTicks).
export const SKIP_CONFIRM_HOLD = 'skip-confirm'

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
    if (paused || tickHolds.size > 0) return
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
  tickHolds.clear()
}

/**
 * Pause/resume ticks (for background tab handling)
 */
export function pauseTicks() { paused = true }
export function resumeTicks() { paused = false }

/**
 * Named tick holds. `paused` is one global flag that ANY owner may clear, so
 * two overlapping owners fight: the loot modal's cleanup resumeTicks() lands
 * after the skip-confirm prompt has paused, and combat ticks on under the
 * prompt. A hold is lifted only by the key that took it, so it cannot be
 * cleared out from under its owner. Ticks run only with no hold outstanding.
 */
export function holdTicks(key) { tickHolds.add(key) }
export function releaseTicks(key) { tickHolds.delete(key) }

/**
 * Get current tick count
 */
export function getTickCount() { return tickCount }

/**
 * Reset tick count (for new game)
 */
export function resetTicks() { tickCount = 0 }
