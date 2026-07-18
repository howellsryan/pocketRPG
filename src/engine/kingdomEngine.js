/**
 * Kingdom of Royals engine — passive coffer-funded gathering.
 * Client-trusted (§14): output is ordinary commodity resources (no uniques,
 * no credits), so this rides the save blob like idle/offline catch-up does.
 * Pure functions, no UI imports.
 */
import { getLevelFromXP } from './experience.js'
import { getEligibleTiers, pickWeightedTier } from './kingdomResources.js'
import {
  KINGDOM_CATEGORIES, KINGDOM_COFFER_MAX, KINGDOM_DAILY_COST, KINGDOM_LABOUR_POINTS_MAX, KINGDOM_PACE_FACTOR,
} from '../utils/constants.js'

const DAY_MS = 24 * 60 * 60 * 1000
export const KINGDOM_COINS_PER_MS = KINGDOM_DAILY_COST / DAY_MS

export const DEFAULT_KINGDOM = Object.freeze({
  cofferBalance: 0,
  allocations: Object.freeze({ mining: 0, fishing: 0, woodcutting: 0, farming: 0 }),
  lastTickAt: null,
  pendingLoot: Object.freeze({}),
})

function clampInt(value, min, max) {
  const n = Math.floor(Number(value) || 0)
  return Math.max(min, Math.min(max, n))
}

/** Normalise+clamp a (possibly missing/corrupted) saved kingdom object. Defensive, not anti-cheat. */
export function normaliseKingdomState(raw) {
  const base = raw && typeof raw === 'object' ? raw : {}
  const rawAllocations = base.allocations && typeof base.allocations === 'object' ? base.allocations : {}
  const allocations = {}
  let total = 0
  for (const category of KINGDOM_CATEGORIES) {
    const points = clampInt(rawAllocations[category], 0, KINGDOM_LABOUR_POINTS_MAX)
    allocations[category] = points
    total += points
  }
  if (total > KINGDOM_LABOUR_POINTS_MAX) {
    let overflow = total - KINGDOM_LABOUR_POINTS_MAX
    const order = [...KINGDOM_CATEGORIES].sort((a, b) => allocations[b] - allocations[a])
    for (const category of order) {
      if (overflow <= 0) break
      const take = Math.min(allocations[category], overflow)
      allocations[category] -= take
      overflow -= take
    }
  }
  const cofferBalance = clampInt(base.cofferBalance, 0, KINGDOM_COFFER_MAX)
  const lastTickAt = Number.isFinite(Number(base.lastTickAt)) ? Number(base.lastTickAt) : null
  const pendingLoot = normaliseItemMap(base.pendingLoot)
  return { cofferBalance, allocations, lastTickAt, pendingLoot }
}

function normaliseItemMap(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [itemId, qty] of Object.entries(raw)) {
    const n = Math.floor(Number(qty) || 0)
    if (n > 0) out[itemId] = n
  }
  return out
}

/** Merge two item-id -> quantity maps into a new one. Never mutates either input. */
export function mergeLoot(a, b) {
  const out = { ...normaliseItemMap(a) }
  for (const [itemId, qty] of Object.entries(normaliseItemMap(b))) {
    out[itemId] = (out[itemId] || 0) + qty
  }
  return out
}

/**
 * Clear pendingLoot for withdrawal to the bank. Returns the kingdom with an
 * empty pendingLoot and the loot map that was withdrawn (for the caller to
 * hand to updateBankDirect) — never mutates the input.
 */
export function withdrawAllLoot(kingdom) {
  const state = normaliseKingdomState(kingdom)
  return { kingdom: { ...state, pendingLoot: {} }, withdrawn: state.pendingLoot }
}

export function totalAllocatedPoints(allocations) {
  return KINGDOM_CATEGORIES.reduce((sum, category) => sum + clampInt(allocations?.[category], 0, KINGDOM_LABOUR_POINTS_MAX), 0)
}

/** Clamp a proposed allocation map to the 4-point budget. Used by the screen before persisting. */
export function clampAllocations(allocations) {
  return normaliseKingdomState({ allocations }).allocations
}

export function depositToCoffer(kingdom, amount) {
  const state = normaliseKingdomState(kingdom)
  const add = Math.max(0, Math.floor(Number(amount) || 0))
  return { ...state, cofferBalance: Math.min(KINGDOM_COFFER_MAX, state.cofferBalance + add) }
}

export function withdrawFromCoffer(kingdom, amount) {
  const state = normaliseKingdomState(kingdom)
  const sub = Math.max(0, Math.floor(Number(amount) || 0))
  return { ...state, cofferBalance: state.cofferBalance - Math.min(sub, state.cofferBalance) }
}

/**
 * Simulate elapsed kingdom time: drain the coffer at the flat daily rate and
 * produce tier-weighted, level-gated resources for each allocated labour
 * point. Coffer draining and output both stop the instant funds run out —
 * a long absence self-limits to at most the coffer's ~10-day runtime.
 * Returns { cofferBalance, coinsDrained, itemsGained: { itemId: qty } }
 */
export function simulateKingdom(kingdom, stats, elapsedMs, itemsData = {}) {
  const state = normaliseKingdomState(kingdom)
  const itemsGained = {}
  const totalPoints = totalAllocatedPoints(state.allocations)

  if (!(elapsedMs > 0) || totalPoints <= 0 || state.cofferBalance <= 0) {
    return { cofferBalance: state.cofferBalance, coinsDrained: 0, itemsGained }
  }

  // Coins drain at a flat daily rate while any labour is allocated — the
  // coffer funds the kingdom's operation, not per-worker wages. Cap the
  // funded window to what the coffer can actually pay for.
  const cofferRuntimeMs = state.cofferBalance / KINGDOM_COINS_PER_MS
  const fundedMs = Math.min(elapsedMs, cofferRuntimeMs)
  const coinsDrained = Math.min(state.cofferBalance, Math.ceil(fundedMs * KINGDOM_COINS_PER_MS))
  const cofferBalance = Math.max(0, state.cofferBalance - coinsDrained)

  for (const category of KINGDOM_CATEGORIES) {
    const points = state.allocations[category]
    if (points <= 0) continue
    const level = getLevelFromXP(stats?.[category]?.xp || 0)
    const tiers = getEligibleTiers(category, level)
    if (tiers.length === 0) continue

    // One labour point = one worker at 50% of a real player's pace. Use the
    // average action speed across eligible tiers as that worker's cadence —
    // a real gatherer splits time across whatever they're able to work.
    const avgActionMs = tiers.reduce((sum, t) => sum + t.actionMs, 0) / tiers.length
    const workerActionMs = avgActionMs / KINGDOM_PACE_FACTOR
    const actionsPerWorker = Math.floor(fundedMs / workerActionMs)
    if (actionsPerWorker <= 0) continue
    const totalActions = actionsPerWorker * points

    for (let i = 0; i < totalActions; i++) {
      const tier = pickWeightedTier(tiers)
      if (!tier) continue
      itemsGained[tier.product] = (itemsGained[tier.product] || 0) + 1
    }
  }

  return { cofferBalance, coinsDrained, itemsGained }
}

/** Estimated coffer runtime remaining, in ms, at the current allocation (0 if idle/empty). */
export function estimateRuntimeMs(kingdom) {
  const state = normaliseKingdomState(kingdom)
  if (totalAllocatedPoints(state.allocations) <= 0 || state.cofferBalance <= 0) return 0
  return state.cofferBalance / KINGDOM_COINS_PER_MS
}
