import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  DEFAULT_KINGDOM,
  KINGDOM_COINS_PER_MS,
  normaliseKingdomState,
  totalAllocatedPoints,
  clampAllocations,
  depositToCoffer,
  withdrawFromCoffer,
  simulateKingdom,
  estimateRuntimeMs,
  mergeLoot,
  withdrawAllLoot,
} from '../src/engine/kingdomEngine.js'
import { KINGDOM_RESOURCE_TIERS, getEligibleTiers, pickWeightedTier } from '../src/engine/kingdomResources.js'
import { KINGDOM_CATEGORIES, KINGDOM_COFFER_MAX, KINGDOM_DAILY_COST, KINGDOM_LABOUR_POINTS_MAX } from '../src/utils/constants.js'
import { createDefaultStats } from '../src/engine/createDefaultSave.js'
import itemsData from '../src/data/items.json'

const DAY_MS = 24 * 60 * 60 * 1000

function statsAtLevel(level: number) {
  const stats = createDefaultStats()
  for (const category of KINGDOM_CATEGORIES) {
    // XP value doesn't matter for these tests beyond producing the target level;
    // use a very generous xp so every category clears any tested level.
    stats[category] = { skill: category, xp: level >= 99 ? 200_000_000 : xpForLevelAtLeast(level), level }
  }
  return stats
}

// Rough XP finder good enough for test purposes (getLevelFromXP is monotonic).
import { getLevelFromXP } from '../src/engine/experience.js'
function xpForLevelAtLeast(level: number) {
  let xp = 0
  while (getLevelFromXP(xp) < level && xp < 200_000_000) xp += 1000
  return xp
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('kingdomResources', () => {
  it('every category tier ladder is sorted ascending by level with no gaps in the source data', () => {
    for (const category of KINGDOM_CATEGORIES) {
      const tiers = KINGDOM_RESOURCE_TIERS[category]
      expect(tiers.length).toBeGreaterThan(0)
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i].level).toBeGreaterThanOrEqual(tiers[i - 1].level)
      }
    }
  })

  it('every tier product resolves to a real item', () => {
    for (const category of KINGDOM_CATEGORIES) {
      for (const tier of KINGDOM_RESOURCE_TIERS[category]) {
        expect(itemsData[tier.product], `${category}:${tier.id} -> ${tier.product}`).toBeTruthy()
      }
    }
  })

  it('Farm Herbs tiers output the plain herb crop item, not a grimy variant', () => {
    for (const tier of KINGDOM_RESOURCE_TIERS.farming) {
      expect(tier.product).not.toMatch(/grimy/i)
    }
  })

  it('every tier action speed is within a sane range comparable across categories', () => {
    // Regression guard for the class of bug that made Farm Herbs produce
    // zero output: farming.json's growthTimeMs (an 80-minute *passive wait*
    // for a real player's planted patch) was reused as a Kingdom worker's
    // per-action cadence, ~2000x slower than every other category's tiers.
    // A 20x spread comfortably covers the real tick-based range (2.4s-18s)
    // without masking a future mistake of the same shape.
    const allActionMs = KINGDOM_CATEGORIES.flatMap(category => KINGDOM_RESOURCE_TIERS[category].map(t => t.actionMs))
    const min = Math.min(...allActionMs)
    const max = Math.max(...allActionMs)
    expect(max / min).toBeLessThan(20)
  })

  it('getEligibleTiers only returns tiers at or below the given level', () => {
    const tiers = getEligibleTiers('mining', 30)
    expect(tiers.every(t => t.level <= 30)).toBe(true)
    expect(tiers.some(t => t.level > 30)).toBe(false)
    // A level below every tier's requirement yields nothing.
    expect(getEligibleTiers('mining', 0)).toEqual([])
  })

  it('pickWeightedTier favours lower-level (lower-weight-index) tiers with a low roll and rarer tiers with a high roll', () => {
    const tiers = getEligibleTiers('mining', 99) // full ladder eligible
    const lowRoll = pickWeightedTier(tiers, () => 0)
    expect(lowRoll?.id).toBe(tiers[0].id)
    const highRoll = pickWeightedTier(tiers, () => 0.9999)
    expect(highRoll?.id).toBe(tiers[tiers.length - 1].id)
  })
})

describe('kingdomEngine — allocations', () => {
  it('normaliseKingdomState clamps a missing/corrupt save to safe defaults', () => {
    expect(normaliseKingdomState(null)).toEqual(DEFAULT_KINGDOM)
    expect(normaliseKingdomState(undefined)).toEqual(DEFAULT_KINGDOM)
  })

  it('normaliseKingdomState clamps each allocation to [0, 4]', () => {
    const state = normaliseKingdomState({ allocations: { mining: 99, fishing: -5, woodcutting: 2, farming: 1 } })
    expect(state.allocations.mining).toBeLessThanOrEqual(KINGDOM_LABOUR_POINTS_MAX)
    expect(state.allocations.fishing).toBe(0)
  })

  it('normaliseKingdomState clamps the allocation total to the 4-point budget', () => {
    const state = normaliseKingdomState({ allocations: { mining: 4, fishing: 4, woodcutting: 4, farming: 4 } })
    expect(totalAllocatedPoints(state.allocations)).toBeLessThanOrEqual(KINGDOM_LABOUR_POINTS_MAX)
  })

  it('normaliseKingdomState clamps cofferBalance to [0, KINGDOM_COFFER_MAX]', () => {
    expect(normaliseKingdomState({ cofferBalance: -100 }).cofferBalance).toBe(0)
    expect(normaliseKingdomState({ cofferBalance: KINGDOM_COFFER_MAX * 10 }).cofferBalance).toBe(KINGDOM_COFFER_MAX)
  })

  it('clampAllocations mirrors normaliseKingdomState for a raw allocations map', () => {
    expect(clampAllocations({ mining: 1, fishing: 1, woodcutting: 1, farming: 1 })).toEqual({ mining: 1, fishing: 1, woodcutting: 1, farming: 1 })
  })

  it('a valid 1/1/1/1 split is accepted unchanged', () => {
    const state = normaliseKingdomState({ allocations: { mining: 1, fishing: 1, woodcutting: 1, farming: 1 } })
    expect(state.allocations).toEqual({ mining: 1, fishing: 1, woodcutting: 1, farming: 1 })
  })

  it('all 4 points on one category is accepted unchanged', () => {
    const state = normaliseKingdomState({ allocations: { mining: 4, fishing: 0, woodcutting: 0, farming: 0 } })
    expect(state.allocations.mining).toBe(4)
    expect(totalAllocatedPoints(state.allocations)).toBe(4)
  })
})

describe('kingdomEngine — coffer', () => {
  it('depositToCoffer adds coins and caps at KINGDOM_COFFER_MAX', () => {
    const deposited = depositToCoffer(DEFAULT_KINGDOM, 1000)
    expect(deposited.cofferBalance).toBe(1000)
    const overCapped = depositToCoffer({ ...DEFAULT_KINGDOM, cofferBalance: KINGDOM_COFFER_MAX - 10 }, 1000)
    expect(overCapped.cofferBalance).toBe(KINGDOM_COFFER_MAX)
  })

  it('withdrawFromCoffer removes coins and floors at 0', () => {
    const withdrawn = withdrawFromCoffer({ ...DEFAULT_KINGDOM, cofferBalance: 1000 }, 400)
    expect(withdrawn.cofferBalance).toBe(600)
    const overWithdrawn = withdrawFromCoffer({ ...DEFAULT_KINGDOM, cofferBalance: 100 }, 500)
    expect(overWithdrawn.cofferBalance).toBe(0)
  })

  it('KINGDOM_COINS_PER_MS matches "10,000,000 coins drains the coffer in 24h"', () => {
    expect(KINGDOM_COINS_PER_MS * DAY_MS).toBeCloseTo(KINGDOM_DAILY_COST, 6)
  })

  it('estimateRuntimeMs is 0 when idle (no points) or empty, and matches the daily-cost rate otherwise', () => {
    expect(estimateRuntimeMs({ ...DEFAULT_KINGDOM, cofferBalance: 1_000_000, allocations: { mining: 0, fishing: 0, woodcutting: 0, farming: 0 } })).toBe(0)
    expect(estimateRuntimeMs({ ...DEFAULT_KINGDOM, cofferBalance: 0, allocations: { mining: 1, fishing: 0, woodcutting: 0, farming: 0 } })).toBe(0)
    const runtime = estimateRuntimeMs({ ...DEFAULT_KINGDOM, cofferBalance: KINGDOM_DAILY_COST, allocations: { mining: 1, fishing: 0, woodcutting: 0, farming: 0 } })
    expect(runtime).toBeCloseTo(DAY_MS, 3)
  })
})

describe('kingdomEngine — simulateKingdom', () => {
  it('produces no output and drains no coins when elapsedMs is 0', () => {
    const kingdom = { ...DEFAULT_KINGDOM, cofferBalance: 1_000_000, allocations: { mining: 1, fishing: 0, woodcutting: 0, farming: 0 } }
    const result = simulateKingdom(kingdom, statsAtLevel(50), 0, itemsData)
    expect(result.coinsDrained).toBe(0)
    expect(result.itemsGained).toEqual({})
    expect(result.cofferBalance).toBe(1_000_000)
  })

  it('produces no output when the coffer is empty even with points allocated', () => {
    const kingdom = { ...DEFAULT_KINGDOM, cofferBalance: 0, allocations: { mining: 4, fishing: 0, woodcutting: 0, farming: 0 } }
    const result = simulateKingdom(kingdom, statsAtLevel(99), DAY_MS, itemsData)
    expect(result.coinsDrained).toBe(0)
    expect(result.itemsGained).toEqual({})
  })

  it('produces no output and no coin drain when no labour points are allocated', () => {
    const kingdom = { ...DEFAULT_KINGDOM, cofferBalance: KINGDOM_COFFER_MAX, allocations: { mining: 0, fishing: 0, woodcutting: 0, farming: 0 } }
    const result = simulateKingdom(kingdom, statsAtLevel(99), DAY_MS, itemsData)
    expect(result.coinsDrained).toBe(0)
    expect(result.itemsGained).toEqual({})
    expect(result.cofferBalance).toBe(KINGDOM_COFFER_MAX)
  })

  it('drains coins at the flat daily rate over a funded window, independent of point count', () => {
    const oneHour = DAY_MS / 24
    const withOnePoint = simulateKingdom(
      { ...DEFAULT_KINGDOM, cofferBalance: KINGDOM_COFFER_MAX, allocations: { mining: 1, fishing: 0, woodcutting: 0, farming: 0 } },
      statsAtLevel(50), oneHour, itemsData,
    )
    const withFourPoints = simulateKingdom(
      { ...DEFAULT_KINGDOM, cofferBalance: KINGDOM_COFFER_MAX, allocations: { mining: 1, fishing: 1, woodcutting: 1, farming: 1 } },
      statsAtLevel(50), oneHour, itemsData,
    )
    const expectedDrain = Math.round(KINGDOM_DAILY_COST / 24)
    expect(withOnePoint.coinsDrained).toBeCloseTo(expectedDrain, -1)
    expect(withFourPoints.coinsDrained).toBeCloseTo(expectedDrain, -1)
  })

  it('coffer balance and output both stop the instant funds run out mid-window', () => {
    // Only enough coins for ~1 hour of funding, but the elapsed window is a full day.
    const oneHourOfCoins = Math.ceil(KINGDOM_DAILY_COST / 24)
    const kingdom = { ...DEFAULT_KINGDOM, cofferBalance: oneHourOfCoins, allocations: { mining: 4, fishing: 0, woodcutting: 0, farming: 0 } }
    const result = simulateKingdom(kingdom, statsAtLevel(99), DAY_MS, itemsData)
    expect(result.cofferBalance).toBe(0)
    expect(result.coinsDrained).toBe(oneHourOfCoins)
    // Never goes negative.
    expect(result.cofferBalance).toBeGreaterThanOrEqual(0)
  })

  it('a low-level player never produces tiers above their level', () => {
    const kingdom = { ...DEFAULT_KINGDOM, cofferBalance: KINGDOM_COFFER_MAX, allocations: { mining: 4, fishing: 0, woodcutting: 0, farming: 0 } }
    const result = simulateKingdom(kingdom, statsAtLevel(1), DAY_MS, itemsData)
    const eligibleProducts = new Set(getEligibleTiers('mining', 1).map(t => t.product))
    expect(Object.keys(result.itemsGained).length).toBeGreaterThan(0)
    for (const itemId of Object.keys(result.itemsGained)) {
      expect(eligibleProducts.has(itemId)).toBe(true)
    }
    // runeforged_ore (level 85) must never appear for a level-1 miner.
    expect(result.itemsGained.runeforged_ore).toBeUndefined()
  })

  it('Farm Herbs output is gated by the Farming level, not Herblore', () => {
    const stats = statsAtLevel(1)
    stats.herblore = { skill: 'herblore', xp: 0, level: 1 } // maxed nothing, Herblore stays at 1
    stats.farming = { skill: 'farming', xp: xpForLevelAtLeast(60), level: 60 } // eligible for every herb tier
    const kingdom = { ...DEFAULT_KINGDOM, cofferBalance: KINGDOM_COFFER_MAX, allocations: { mining: 0, fishing: 0, woodcutting: 0, farming: 4 } }
    const result = simulateKingdom(kingdom, stats, DAY_MS, itemsData)
    const totalHerbs = Object.values(result.itemsGained).reduce((sum, qty) => sum + qty, 0)
    expect(totalHerbs).toBeGreaterThan(0)
    // Every produced item must be one of the known herb crop ids.
    const herbProducts = new Set(KINGDOM_RESOURCE_TIERS.farming.map(t => t.product))
    for (const itemId of Object.keys(result.itemsGained)) {
      expect(herbProducts.has(itemId)).toBe(true)
    }
  })

  it('reports gathered output as a flat item-id -> quantity map (no inventory/travel step)', () => {
    const kingdom = { ...DEFAULT_KINGDOM, cofferBalance: KINGDOM_COFFER_MAX, allocations: { mining: 4, fishing: 0, woodcutting: 0, farming: 0 } }
    const result = simulateKingdom(kingdom, statsAtLevel(99), DAY_MS, itemsData)
    expect(Object.keys(result.itemsGained).length).toBeGreaterThan(0)
    for (const [itemId, qty] of Object.entries(result.itemsGained)) {
      expect(typeof itemId).toBe('string')
      expect(qty).toBeGreaterThan(0)
      expect(Number.isInteger(qty)).toBe(true)
    }
  })

  it('more allocated points to a category produce proportionally more of that category\'s output', () => {
    const onePoint = simulateKingdom(
      { ...DEFAULT_KINGDOM, cofferBalance: KINGDOM_COFFER_MAX, allocations: { mining: 1, fishing: 0, woodcutting: 0, farming: 0 } },
      statsAtLevel(99), DAY_MS, itemsData,
    )
    const fourPoints = simulateKingdom(
      { ...DEFAULT_KINGDOM, cofferBalance: KINGDOM_COFFER_MAX, allocations: { mining: 4, fishing: 0, woodcutting: 0, farming: 0 } },
      statsAtLevel(99), DAY_MS, itemsData,
    )
    const totalOne = Object.values(onePoint.itemsGained).reduce((sum, qty) => sum + qty, 0)
    const totalFour = Object.values(fourPoints.itemsGained).reduce((sum, qty) => sum + qty, 0)
    expect(totalFour).toBeCloseTo(totalOne * 4, -1)
  })

  it('is deterministic given a fixed rng', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const kingdom = { ...DEFAULT_KINGDOM, cofferBalance: KINGDOM_COFFER_MAX, allocations: { mining: 1, fishing: 0, woodcutting: 0, farming: 0 } }
    const a = simulateKingdom(kingdom, statsAtLevel(99), DAY_MS, itemsData)
    const b = simulateKingdom(kingdom, statsAtLevel(99), DAY_MS, itemsData)
    expect(a.itemsGained).toEqual(b.itemsGained)
    // With rng pinned to 0, every pick lands on the lowest-weight-index (lowest level) tier.
    const cheapestTier = KINGDOM_RESOURCE_TIERS.mining[0]
    expect(Object.keys(a.itemsGained)).toEqual([cheapestTier.product])
  })

  it('every category produces output within a normal 1-hour session when fully staffed at max level', () => {
    // Structural guard: whenever a category's action-speed data changes,
    // this fails loudly instead of silently producing zero output (the
    // Farm Herbs bug — see the kingdomResources describe block above).
    const oneHour = 60 * 60 * 1000
    for (const category of KINGDOM_CATEGORIES) {
      const allocations = { mining: 0, fishing: 0, woodcutting: 0, farming: 0, [category]: KINGDOM_LABOUR_POINTS_MAX }
      const kingdom = { ...DEFAULT_KINGDOM, cofferBalance: KINGDOM_COFFER_MAX, allocations }
      const result = simulateKingdom(kingdom, statsAtLevel(99), oneHour, itemsData)
      const total = Object.values(result.itemsGained).reduce((sum, qty) => sum + qty, 0)
      expect(total, `${category} produced 0 output in a fully-staffed 1-hour session`).toBeGreaterThan(0)
    }
  })

  it('Farm Herbs produces output at a modest Farming level with only 2 of 4 points allocated (the reported bug scenario)', () => {
    const stats = statsAtLevel(1)
    stats.farming = { skill: 'farming', xp: xpForLevelAtLeast(20), level: 20 }
    const kingdom = { ...DEFAULT_KINGDOM, cofferBalance: KINGDOM_COFFER_MAX, allocations: { mining: 0, fishing: 0, woodcutting: 0, farming: 2 } }
    const result = simulateKingdom(kingdom, stats, 60 * 60 * 1000, itemsData)
    const total = Object.values(result.itemsGained).reduce((sum, qty) => sum + qty, 0)
    expect(total).toBeGreaterThan(0)
  })
})

describe('kingdomEngine — pending loot (gathered output does not auto-bank)', () => {
  it('normaliseKingdomState defaults pendingLoot to an empty map', () => {
    expect(normaliseKingdomState(null).pendingLoot).toEqual({})
    expect(normaliseKingdomState({}).pendingLoot).toEqual({})
  })

  it('normaliseKingdomState drops non-positive or non-numeric pendingLoot quantities', () => {
    const state = normaliseKingdomState({ pendingLoot: { tin_ore: 5, copper_ore: 0, iron_ore: -3, coal: 'nope' } })
    expect(state.pendingLoot).toEqual({ tin_ore: 5 })
  })

  it('mergeLoot adds quantities for shared items and keeps unique ones from both sides', () => {
    expect(mergeLoot({ tin_ore: 5 }, { tin_ore: 3, copper_ore: 2 })).toEqual({ tin_ore: 8, copper_ore: 2 })
  })

  it('mergeLoot does not mutate either input', () => {
    const a = { tin_ore: 5 }
    const b = { copper_ore: 2 }
    mergeLoot(a, b)
    expect(a).toEqual({ tin_ore: 5 })
    expect(b).toEqual({ copper_ore: 2 })
  })

  it('mergeLoot treats missing/null inputs as empty', () => {
    expect(mergeLoot(null, { tin_ore: 1 })).toEqual({ tin_ore: 1 })
    expect(mergeLoot({ tin_ore: 1 }, undefined)).toEqual({ tin_ore: 1 })
  })

  it('withdrawAllLoot empties pendingLoot and returns exactly what was withdrawn', () => {
    const kingdom = { ...DEFAULT_KINGDOM, pendingLoot: { tin_ore: 10, copper_ore: 4 } }
    const { kingdom: next, withdrawn } = withdrawAllLoot(kingdom)
    expect(withdrawn).toEqual({ tin_ore: 10, copper_ore: 4 })
    expect(next.pendingLoot).toEqual({})
    // Everything else on the kingdom is preserved.
    expect(next.cofferBalance).toBe(kingdom.cofferBalance)
    expect(next.allocations).toEqual(kingdom.allocations)
  })

  it('withdrawAllLoot on an empty pendingLoot is a no-op', () => {
    const { withdrawn } = withdrawAllLoot(DEFAULT_KINGDOM)
    expect(withdrawn).toEqual({})
  })

  it('simulateKingdom itself never touches pendingLoot — accumulation is the caller\'s job', () => {
    const kingdom = { ...DEFAULT_KINGDOM, cofferBalance: KINGDOM_COFFER_MAX, allocations: { mining: 4, fishing: 0, woodcutting: 0, farming: 0 } }
    const result = simulateKingdom(kingdom, statsAtLevel(99), DAY_MS, itemsData)
    expect(result.pendingLoot).toBeUndefined()
    // The caller (gameState.jsx) is expected to fold result.itemsGained into
    // kingdom.pendingLoot via mergeLoot — verify that composition works end to end.
    const accumulated = mergeLoot(kingdom.pendingLoot, result.itemsGained)
    expect(Object.keys(accumulated).length).toBeGreaterThan(0)
  })
})
