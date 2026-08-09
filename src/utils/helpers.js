import { combatLevelFromLevels } from '../engine/combatLevel.js'
import { markWorldHandoff } from '../cloud/worldHandoff.js'

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

/** Fallback world deployment for Vite dev, where no single-file build runs and
 * nothing is baked. The preview Worker, never production. */
const WORLD_ORIGIN_FALLBACK = 'https://pocketrpg-world-preview.rlh.workers.dev'

/**
 * The 3D open-world deployment this build hands off to. Baked by
 * build_single.cjs (main → world.pocketrpg.co.uk, everything else → preview)
 * and read lazily for the same reason as the flags below.
 */
export function worldOrigin() {
  return typeof pocketWorldOrigin !== 'undefined' ? pocketWorldOrigin : WORLD_ORIGIN_FALLBACK
}

/**
 * Whether the whole open world may be entered — the Help screen's "Enter
 * World" button, which lands the player in the overworld. `pocketWorldBetaEnabled`
 * is baked in at build time by build_single.cjs (preview on, production off;
 * override with EnableWorldBeta) and lives in the game chunk, so it is read
 * lazily here — never at module evaluation (CLAUDE.md §12) — and guarded for
 * Vite dev, where no single-file build runs.
 */
export function worldBetaEnabled() {
  return typeof pocketWorldBetaEnabled !== 'undefined' ? Boolean(pocketWorldBetaEnabled) : true
}

/**
 * Whether a boss's instanced open-world lair may be entered from the combat
 * picker. Deliberately independent of `worldBetaEnabled()` above: a lair is a
 * single authored room, so it ships to production while the overworld does
 * not. Don't collapse the two back together.
 */
export function worldBossLairsEnabled() {
  return typeof pocketWorldLairsEnabled !== 'undefined' ? Boolean(pocketWorldLairsEnabled) : true
}

/**
 * Opens the open world in a new tab, optionally asking to land in a specific
 * instanced zone (a boss lair). The handoff is single-use and 60s-lived, so it
 * is fetched at click time, never held.
 */
export async function openWorld(api, zone) {
  const { handoff } = await api.requestWorldHandoff(zone)
  // From here the world is the save's writer, and this tab's own IndexedDB
  // writes must stop outranking the cloud copy on the next boot — see
  // cloud/worldHandoff.js for why that costs a Wilderness loot pile otherwise.
  markWorldHandoff()
  window.open(`${worldOrigin()}/#handoff=${handoff}`, '_blank')
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

// Turns the chat widget sends back to /api/chat as conversation context.
// `local: true` marks a line the widget wrote itself — the greeting, a
// connection error, the cancel acknowledgement, an account receipt — which is
// not model output and must never be replayed as one: it teaches the helper an
// apologetic register, and in a window bounded by what the server can afford it
// evicts a real turn to do it. How much of the transcript survives is the
// server's call (CHAT_MAX_HISTORY_* in functions/_lib/chat/prompt.js) — send
// generously and let it budget, rather than truncating twice by two rules that
// then have to be kept in step.
export const CHAT_HISTORY_TURNS = 20
export function chatHistoryPayload(messages) {
  return (messages || [])
    .filter((m) => m && !m.local && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-CHAT_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content }))
}

/**
 * How many players are in the Wilderness right now, for the PvP card's live
 * headcount. Served by the world Worker (not Pages, which has no WorldZone
 * binding) and fetched straight from the world origin under CORS.
 *
 * Resolves null on any failure — an unreachable count must never be the reason
 * a player can't see the entry card, so callers hide the number rather than
 * showing an error.
 */
export async function fetchWildernessCount() {
  try {
    const res = await fetch(`${worldOrigin()}/api/world/pvp-count`)
    if (!res.ok) return null
    const body = await res.json()
    const count = Number(body?.count)
    return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null
  } catch {
    return null
  }
}
