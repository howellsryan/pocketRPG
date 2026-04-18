/**
 * Random integer between min and max (inclusive)
 */
export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Format a number with commas: 1234567 → "1,234,567"
 */
export function formatNumber(n) {
  return n.toLocaleString('en-US')
}

/**
 * Format an item quantity for display.
 * >= 1,000,000,000 → e.g. "82B" (isM: true, shown in green)
 * >= 10,000,000    → e.g. "956M" (isM: true, shown in green)
 * >= 100,000       → e.g. "105k" (isM: false, shown in gold)
 * otherwise        → plain number string
 */
export function formatQuantity(n) {
  if (n >= 1_000_000_000) return { text: `${Math.floor(n / 1_000_000_000)}B`, isM: true }
  if (n >= 10_000_000) return { text: `${Math.floor(n / 1_000_000)}M`, isM: true }
  if (n >= 100_000) return { text: `${Math.floor(n / 1_000)}k`, isM: false }
  return { text: String(n), isM: false }
}

/**
 * Format ticks to human-readable time
 */
export function ticksToTime(ticks) {
  const seconds = (ticks * 0.6)
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}m ${secs}s`
}

/**
 * Clamp a value between min and max
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

/**
 * Deep clone a plain object
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

/**
 * Debounce a function
 */
export function debounce(fn, ms) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

/**
 * Calculate combat level from skills
 */
export function calcCombatLevel(stats) {
  const base = 0.25 * (stats.defence + stats.hitpoints + Math.floor(stats.prayer / 2))
  const melee = 0.325 * (stats.attack + stats.strength)
  const range = 0.325 * Math.floor(stats.ranged * 1.5)
  const mage = 0.325 * Math.floor(stats.magic * 1.5)
  return Math.floor(base + Math.max(melee, range, mage))
}
