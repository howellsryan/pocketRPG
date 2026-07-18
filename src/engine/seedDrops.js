/**
 * Seed / sapling drop logic — pure, deterministic helpers shared by combat
 * (monster drops), the idle engine, and thieving (Master Farmer rewards).
 * No UI imports.
 *
 * The seed pool is derived from farming.json so any new crop automatically
 * joins both the monster drop tables and the Master Farmer reward table.
 */

import farmingData from '../data/farming.json'

// Every plantable seed / sapling, ascending by farming level. Ties broken by
// id so the ordering (and therefore the rarity ranking) is fully deterministic.
export const SEEDS_BY_LEVEL = [
  ...(farmingData.herbs || []),
  ...(farmingData.trees || []),
  ...(farmingData.fruitTrees || []),
  ...(farmingData.vegetables || []),
]
  .map((s) => ({ id: s.id, level: s.level }))
  .sort((a, b) => a.level - b.level || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

// ─── Monster seed drops ────────────────────────────────────────────────────
// A monster's combat level selects a 3-wide window of seed tiers. Higher
// combat level → higher seed tiers ("the higher the higher"); inside the
// window the top tier is the rarest ("the higher, the rarer"). Bosses and
// raid bosses are excluded — their loot is server-authoritative.

const SEED_WINDOW_WIDTH = 3
const COMBAT_LEVELS_PER_TIER = 12 // combat levels needed to step up one seed tier
const WINDOW_WEIGHTS = [6, 3, 1]  // lowest → highest tier within the window
const MONSTER_SEED_CHANCE = 0.04  // total per-kill chance of any seed drop

/**
 * Seed drop entries for a monster, shaped like normal monster drops
 * ({ itemId, quantity, chance }). Returns [] for bosses / raid bosses or when
 * no seeds are defined. Combat is rolled independently per entry by the caller.
 */
export function getMonsterSeedDrops(monster) {
  if (!monster || monster.boss === true || monster.raidBoss === true) return []
  // Opt-out for monsters that author their own seed/sapling table (or shouldn't
  // drop seeds at all), so the universal window doesn't duplicate or contradict it.
  if (monster.noSeedDrops === true) return []
  const combatLevel = Number(monster.combatLevel) || 0
  const n = SEEDS_BY_LEVEL.length
  if (!n || combatLevel <= 0) return []

  const cap = Math.min(n - 1, Math.floor(combatLevel / COMBAT_LEVELS_PER_TIER))

  // Build the weighted window, deduping clamped tiers (low combat levels).
  const weightById = {}
  for (let w = 0; w < SEED_WINDOW_WIDTH; w++) {
    const idx = Math.max(0, cap - (SEED_WINDOW_WIDTH - 1 - w))
    const id = SEEDS_BY_LEVEL[idx].id
    weightById[id] = (weightById[id] || 0) + WINDOW_WEIGHTS[w]
  }

  const totalWeight = Object.values(weightById).reduce((a, b) => a + b, 0)
  return Object.entries(weightById).map(([itemId, weight]) => ({
    itemId,
    quantity: 1,
    chance: Math.round((MONSTER_SEED_CHANCE * weight / totalWeight) * 10000) / 10000,
  }))
}

// ─── Master Farmer seed rewards ────────────────────────────────────────────
// Every successful pickpocket yields exactly one seed. Rarity decays
// geometrically by tier rank, so low-level seeds are common and high-level
// seeds / saplings are rare — but all of them are obtainable.

const MASTER_FARMER_DECAY = 0.82

/** Weighted reward table: [{ id, weight }] ordered by ascending seed level. */
export function masterFarmerSeedWeights() {
  return SEEDS_BY_LEVEL.map((s, rank) => ({
    id: s.id,
    weight: Math.pow(MASTER_FARMER_DECAY, rank),
  }))
}

/** Roll a single Master Farmer seed id (one seed at a time). */
export function rollMasterFarmerSeed(rng = Math.random) {
  const weights = masterFarmerSeedWeights()
  const total = weights.reduce((a, w) => a + w.weight, 0)
  let roll = rng() * total
  for (const w of weights) {
    roll -= w.weight
    if (roll <= 0) return w.id
  }
  return weights[weights.length - 1].id
}

/** Roll `count` Master Farmer seeds, aggregated into { itemId: quantity }. */
export function rollMasterFarmerSeeds(count, rng = Math.random) {
  const out = {}
  for (let i = 0; i < count; i++) {
    const id = rollMasterFarmerSeed(rng)
    out[id] = (out[id] || 0) + 1
  }
  return out
}
