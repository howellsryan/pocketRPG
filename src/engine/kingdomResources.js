/**
 * Kingdom of Royals — resource tier tables.
 * Derived from the existing skills.json / farming.json tables so tier level,
 * product id, and action speed can never drift from the live game data. No
 * new items are introduced. No UI imports.
 */
import skillsData from '../data/skills.json'
import farmingData from '../data/farming.json'
import { GATHER_TASKS } from './gatherTasks.js'
import { TICK_DURATION } from '../utils/constants.js'

// Curated action-id ladders per gathering skill (excludes non-ladder actions
// like clay/rune essence and the gem_mining drop-table action).
const MINING_TIER_IDS = ['tin', 'copper', 'iron', 'coal', 'gold', 'mithril', 'adamantite', 'runite']
const WOODCUTTING_TIER_IDS = ['normal', 'oak', 'willow', 'teak', 'maple', 'mahogany', 'yew', 'magic', 'redwood']
const FISHING_TIER_IDS = ['shrimps', 'trout', 'tuna', 'crab', 'eel', 'karam', 'shark', 'manta_ray', 'anglerfish']

// Rarer (higher-level) tiers get proportionally less weight in the random pick.
function tierWeight(level) {
  return Math.max(1, Math.round(1000 / (level + 10)))
}

// Real Farming is patch-based (plant once, wait ~80 minutes hands-off, then
// harvest) — farming.json's growthTimeMs measures that passive wait, not an
// active gather action, and is identical across every herb tier. Reusing it
// as the Kingdom worker's per-action cadence made a worker take 2.67+ real
// hours to produce a single herb (after the 50% pace factor), so Farm Herbs
// output rounded to zero in any normal session. Kingdom workers don't model
// planting/waiting, so herbs instead get a flat cadence in the same range as
// the other three skills' slower tiers; rarity is entirely handled by
// tierWeight above, not by this constant.
const FARM_HERB_ACTION_MS = 6000

function buildSkillTiers(skillId, actionIds) {
  const actions = skillsData[skillId]?.actions || []
  return actionIds
    .map(id => actions.find(a => a.id === id))
    .filter(Boolean)
    .map(a => ({ id: a.id, product: a.product, level: a.level, actionMs: a.ticks * TICK_DURATION, weight: tierWeight(a.level) }))
    .sort((a, b) => a.level - b.level)
}

function buildHerbTiers() {
  return (farmingData.herbs || [])
    .map(h => ({ id: h.id, product: h.cropId, level: h.level, actionMs: FARM_HERB_ACTION_MS, weight: tierWeight(h.level) }))
    .sort((a, b) => a.level - b.level)
}

// Gathering — the Gather screen's tasks (potion secondaries, sand, seaweed,
// bowstring). Only the tasks that consume nothing are eligible: a kingdom
// worker has no pack and no purse, so a task with `materials` or `gpCost`
// (the plank/soda-ash/nest conversions) would mint its product from nothing.
// GATHER_TASKS carry no skill or level, so every tier is level 1 — the
// category is ungated and every task is equally likely.
function buildGatherTiers() {
  return GATHER_TASKS
    .filter(t => !t.materials && !t.gpCost)
    .map(t => ({ id: t.id, product: t.product, level: 1, actionMs: t.ticks * TICK_DURATION, weight: tierWeight(1) }))
}

let gatherTiers = null

export const KINGDOM_RESOURCE_TIERS = {
  mining: buildSkillTiers('mining', MINING_TIER_IDS),
  woodcutting: buildSkillTiers('woodcutting', WOODCUTTING_TIER_IDS),
  fishing: buildSkillTiers('fishing', FISHING_TIER_IDS),
  // Farm Herbs — gated/weighted by Farming level (not Herblore); output is
  // the plain herb crop item, this game has no grimy-herb variant.
  farming: buildHerbTiers(),
  // Lazy: reading GATHER_TASKS at module-eval time is the §12 TDZ hazard that
  // aborts the whole inline bundle if gatherTasks.js is concatenated later.
  get gathering() {
    if (!gatherTiers) gatherTiers = buildGatherTiers()
    return gatherTiers
  },
}

/** Tiers the kingdom can currently produce for a category, given a skill level. */
export function getEligibleTiers(category, level) {
  const tiers = KINGDOM_RESOURCE_TIERS[category] || []
  return tiers.filter(t => t.level <= level)
}

/** Weighted-random tier pick. `rng` defaults to Math.random, injectable for tests. */
export function pickWeightedTier(tiers, rng = Math.random) {
  if (!tiers || tiers.length === 0) return null
  const total = tiers.reduce((sum, t) => sum + t.weight, 0)
  let roll = rng() * total
  for (const tier of tiers) {
    roll -= tier.weight
    if (roll <= 0) return tier
  }
  return tiers[tiers.length - 1]
}
