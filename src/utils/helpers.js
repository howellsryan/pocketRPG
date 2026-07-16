import { combatLevelFromLevels } from '../engine/combatLevel.js'

/**
 * Random integer between min and max (inclusive)
 */
export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Build a responsive `srcset` for a landing screenshot from its 560px-wide URL.
 * Smaller variants are committed next to the original as `<name>-<width>.webp`
 * (see scripts/gen-landing-variants.cjs). Works for both the Vite build
 * (base-prefixed `/landing/…`) and the single-file build (`/public/landing/…`)
 * since it only rewrites the file extension on the given URL.
 */
export function landingSrcSet(url) {
  if (!url) return undefined
  const base = url.replace(/\.webp$/, '')
  return `${base}-240.webp 240w, ${base}-360.webp 360w, ${base}-480.webp 480w, ${url} 560w`
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
 * Race a promise against a timeout; resolves to `fallback` if the promise
 * hasn't settled by then. Never rejects. Used to guard boot-time cloud calls
 * so a slow/hung endpoint can't trap the user on the loading screen.
 */
export function withTimeout(promise, ms, fallback) {
  return new Promise(resolve => {
    let done = false
    const t = setTimeout(() => {
      if (done) return
      done = true
      console.warn(`[PocketRPG] Cloud call timed out after ${ms}ms, falling back`)
      resolve(fallback)
    }, ms)
    promise.then(
      v => { if (!done) { done = true; clearTimeout(t); resolve(v) } },
      err => {
        if (done) return
        done = true
        clearTimeout(t)
        console.warn('[PocketRPG] Cloud call failed, falling back:', err?.message || err)
        resolve(fallback)
      }
    )
  })
}

/**
 * Calculate combat level from skill LEVELS.
 * Delegates to the single source of truth in src/engine/combatLevel.js so the
 * client UI can never drift from the server's PvP matchmaking computation.
 */
export function calcCombatLevel(stats) {
  return combatLevelFromLevels(stats)
}

/**
 * One-line credit cost for the chat helper's write-action confirm card.
 * `cost` is the { fee, skip, total } breakdown from the server
 * (functions/_lib/chat/actions.js actionCreditCost) — `fee` is 0 when the
 * CHAT_ACTION_FEE_ENABLED flag is off.
 */
export function chatActionCostLine(cost) {
  if (!cost) return 'Costs 1 credit'
  const fee = cost.fee ?? 1
  const skip = cost.skip ?? 0
  const total = cost.total ?? fee + skip
  if (total === 0) return 'Free'
  if (skip > 0) {
    return fee > 0
      ? `Costs ${total} credit${total === 1 ? '' : 's'} — ${fee} action fee + ${skip} for the skip`
      : `Costs ${skip} credit${skip === 1 ? '' : 's'} for the skip`
  }
  return `Costs ${fee} credit${fee === 1 ? '' : 's'}`
}
