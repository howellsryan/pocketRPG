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
// Combat levels per point of seed Farming level. The window is anchored to the
// seed's LEVEL, never its index in the pool: indexing meant every seed added to
// farming.json pushed the top tier further out of reach (the nine Herblore
// herbs alone would have moved Magic Saplings from combat 228 to combat 336,
// off all but two monsters in the game).
const COMBAT_PER_SEED_LEVEL = 3
const WINDOW_WEIGHTS = [6, 3, 1]  // lowest → highest tier within the window
const MONSTER_SEED_CHANCE = 0.04  // total per-kill chance of any seed drop

/** Index of the highest seed whose level a combat level reaches (min 0). */
function seedTierCap(combatLevel) {
  const capLevel = combatLevel / COMBAT_PER_SEED_LEVEL
  let cap = 0
  for (let i = 0; i < SEEDS_BY_LEVEL.length; i++) {
    if (SEEDS_BY_LEVEL[i].level <= capLevel) cap = i
  }
  return cap
}

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

  const cap = Math.min(n - 1, seedTierCap(combatLevel))

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
// geometrically with the seed's LEVEL, so low-level seeds are common and
// high-level seeds / saplings are rare — but all of them are obtainable.
//
// Decaying by level rather than by rank is what makes the table stable as
// content grows: a rank-keyed table re-prices every seed above an insertion
// point, and adding the nine Herblore herbs would have quietly made Magic
// Saplings four times rarer. 0.945 keeps the table's expected value per seed
// (~1.1k gp) where it was before those nine herbs joined it, so Master Farmer
// stays in line with Tzraar, the level-90 thieving target.

const MASTER_FARMER_DECAY = 0.945

/** Weighted reward table: [{ id, weight }] ordered by ascending seed level. */
export function masterFarmerSeedWeights() {
  return SEEDS_BY_LEVEL.map((s) => ({
    id: s.id,
    weight: Math.pow(MASTER_FARMER_DECAY, s.level - 1),
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
