import { describe, expect, it } from 'vitest'
import {
  SEEDS_BY_LEVEL,
  getMonsterSeedDrops,
  masterFarmerSeedWeights,
  rollMasterFarmerSeed,
  rollMasterFarmerSeeds,
} from '../src/engine/seedDrops.js'
import farmingData from '../src/data/farming.json'

const maxSeedLevel = (drops: { itemId: string }[]) =>
  Math.max(0, ...drops.map((d) => SEEDS_BY_LEVEL.find((s) => s.id === d.itemId)!.level))

describe('seed pool', () => {
  it('includes every plantable seed/sapling, ascending by level', () => {
    const expected = [
      ...farmingData.herbs,
      ...farmingData.trees,
      ...farmingData.fruitTrees,
      ...farmingData.vegetables,
    ].length
    expect(SEEDS_BY_LEVEL).toHaveLength(expected)
    for (let i = 1; i < SEEDS_BY_LEVEL.length; i++) {
      expect(SEEDS_BY_LEVEL[i].level).toBeGreaterThanOrEqual(SEEDS_BY_LEVEL[i - 1].level)
    }
    expect(SEEDS_BY_LEVEL[0].id).toBe('greenthorn_seed')
    expect(SEEDS_BY_LEVEL[SEEDS_BY_LEVEL.length - 1].id).toBe('magic_sapling')
  })

  it('includes the new vegetable seeds among the cheapest, lowest-tier seeds', () => {
    expect(SEEDS_BY_LEVEL.some((s) => s.id === 'potato_seed')).toBe(true)
    expect(SEEDS_BY_LEVEL.some((s) => s.id === 'sweetcorn_seed')).toBe(true)
    const potatoRank = SEEDS_BY_LEVEL.findIndex((s) => s.id === 'potato_seed')
    const sweetcornRank = SEEDS_BY_LEVEL.findIndex((s) => s.id === 'sweetcorn_seed')
    // Both sit right after Greenthorn (rank 0) at the very bottom of the ladder.
    expect(potatoRank).toBe(1)
    expect(sweetcornRank).toBe(2)
  })
})

describe('monster seed drops', () => {
  it('excludes bosses and raid bosses', () => {
    expect(getMonsterSeedDrops({ combatLevel: 200, boss: true })).toEqual([])
    expect(getMonsterSeedDrops({ combatLevel: 200, raidBoss: true })).toEqual([])
    expect(getMonsterSeedDrops({ combatLevel: 0 })).toEqual([])
  })

  it('low combat level drops only the lowest seed at the base chance', () => {
    const drops = getMonsterSeedDrops({ combatLevel: 1 })
    expect(drops).toEqual([{ itemId: 'greenthorn_seed', quantity: 1, chance: 0.04 }])
  })

  it('higher combat level shifts to higher-tier seeds', () => {
    const low = getMonsterSeedDrops({ combatLevel: 12 })
    const high = getMonsterSeedDrops({ combatLevel: 240 })
    expect(maxSeedLevel(high)).toBeGreaterThan(maxSeedLevel(low))
    // Highest combat reaches the top sapling tier.
    expect(high.some((d) => d.itemId === 'magic_sapling')).toBe(true)
  })

  it('drops potato/sweetcorn seeds for monsters at or under combat level 50', () => {
    const dropIds = new Set<string>()
    for (let combatLevel = 1; combatLevel <= 50; combatLevel++) {
      for (const d of getMonsterSeedDrops({ combatLevel })) dropIds.add(d.itemId)
    }
    expect(dropIds.has('potato_seed')).toBe(true)
    expect(dropIds.has('sweetcorn_seed')).toBe(true)
  })

  it('within a window the highest-tier seed is the rarest', () => {
    const drops = getMonsterSeedDrops({ combatLevel: 120 })
    const sorted = [...drops].sort(
      (a, b) =>
        SEEDS_BY_LEVEL.find((s) => s.id === a.itemId)!.level -
        SEEDS_BY_LEVEL.find((s) => s.id === b.itemId)!.level,
    )
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].chance).toBeLessThan(sorted[i - 1].chance)
    }
    const total = drops.reduce((a, d) => a + d.chance, 0)
    expect(total).toBeCloseTo(0.04, 3)
  })
})

describe('master farmer seed rewards', () => {
  it('weights decay so higher-level seeds are rarer', () => {
    const weights = masterFarmerSeedWeights()
    expect(weights).toHaveLength(SEEDS_BY_LEVEL.length)
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i].weight).toBeLessThan(weights[i - 1].weight)
    }
  })

  it('makes potato and sweetcorn seeds the 2nd and 3rd most common rewards', () => {
    const weights = masterFarmerSeedWeights()
    const byId = Object.fromEntries(weights.map((w) => [w.id, w.weight]))
    // Greenthorn is rank 0 (most common); potato and sweetcorn immediately follow.
    expect(byId.potato_seed).toBeLessThan(byId.greenthorn_seed)
    expect(byId.sweetcorn_seed).toBeLessThan(byId.potato_seed)
    // Still far more common than the rest of the herb/tree/fruit ladder.
    expect(byId.sweetcorn_seed).toBeGreaterThan(byId.miremint_seed)
  })

  it('rolls a single seed, biased toward the rng position', () => {
    expect(rollMasterFarmerSeed(() => 0)).toBe('greenthorn_seed')
    expect(rollMasterFarmerSeed(() => 0.999999)).toBe('magic_sapling')
  })

  it('aggregates rolled seeds into a quantity map', () => {
    const seeds = rollMasterFarmerSeeds(5, () => 0)
    expect(seeds).toEqual({ greenthorn_seed: 5 })
    const total = Object.values(rollMasterFarmerSeeds(20)).reduce((a, b) => a + b, 0)
    expect(total).toBe(20)
  })
})
