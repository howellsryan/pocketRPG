import { describe, expect, it } from 'vitest'
import {
  SEEDS_BY_LEVEL,
  getMonsterSeedDrops,
  masterFarmerSeedWeights,
  rollMasterFarmerSeed,
  rollMasterFarmerSeeds,
} from '../src/engine/seedDrops.js'
import farmingData from '../src/data/farming.json'
import itemsData from '../src/data/items.json'
import skillsData from '../src/data/skills.json'
import monstersData from '../src/data/monsters.json'

const maxSeedLevel = (drops: { itemId: string }[]) =>
  Math.max(0, ...drops.map((d) => SEEDS_BY_LEVEL.find((s) => s.id === d.itemId)!.level))

// Herblore level of the cheapest potion each herb goes into, derived from the
// live recipe table so a new potion joins this ladder without a test edit.
const herbloreLevelByCrop = () => {
  const levels: Record<string, number> = {}
  for (const action of (skillsData as any).herblore.actions) {
    for (const material of Object.keys(action.materials || {})) {
      if (levels[material] === undefined || action.level < levels[material]) {
        levels[material] = action.level
      }
    }
  }
  return levels
}

// Every herb seed whose crop a potion actually consumes, paired with that
// potion's Herblore requirement.
const herbSeedsByHerbloreLevel = () => {
  const levels = herbloreLevelByCrop()
  return farmingData.herbs
    .filter((h) => levels[h.cropId] !== undefined)
    .map((h) => ({ id: h.id, herbloreLevel: levels[h.cropId] }))
    .sort((a, b) => a.herbloreLevel - b.herbloreLevel)
}

const masterFarmerChances = () => {
  const weights = masterFarmerSeedWeights()
  const total = weights.reduce((sum, w) => sum + w.weight, 0)
  return Object.fromEntries(weights.map((w) => [w.id, w.weight / total]))
}

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
    expect(SEEDS_BY_LEVEL[SEEDS_BY_LEVEL.length - 1].id).toBe('thornspire_seed')
  })

  it('has a plantable seed for every herb a potion consumes', () => {
    const seeds = herbSeedsByHerbloreLevel()
    // Thornspire (super combat, Herblore 90) is the top of the potion ladder;
    // before this existed the seed pool stopped at Rynarr.
    expect(seeds.some((s) => s.id === 'thornspire_seed')).toBe(true)
    for (const seed of seeds) {
      expect(SEEDS_BY_LEVEL.some((s) => s.id === seed.id)).toBe(true)
      expect((itemsData as Record<string, any>)[seed.id]).toBeDefined()
    }
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

  it('keeps the top seed tier reachable by the strongest ordinary monster', () => {
    // The window is anchored to the seed's level, not its index in the pool, so
    // adding seeds can never push the top tier past the strongest monster in
    // the game the way a rank-indexed window did.
    const strongest = Math.max(
      ...Object.values(monstersData as Record<string, any>)
        .filter((m) => m.boss !== true && m.raidBoss !== true)
        .map((m) => Number(m.combatLevel) || 0),
    )
    const drops = getMonsterSeedDrops({ combatLevel: strongest })
    expect(maxSeedLevel(drops)).toBe(SEEDS_BY_LEVEL[SEEDS_BY_LEVEL.length - 1].level)
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
      // Keyed off the seed's level, so two seeds of the same level tie rather
      // than the later one being arbitrarily rarer for its position.
      const stepsUp = SEEDS_BY_LEVEL[i].level > SEEDS_BY_LEVEL[i - 1].level
      if (stepsUp) expect(weights[i].weight).toBeLessThan(weights[i - 1].weight)
      else expect(weights[i].weight).toBe(weights[i - 1].weight)
    }
  })

  it('rewards every herb seed, rarest at the top of the Herblore ladder', () => {
    const chances = masterFarmerChances()
    const herbs = herbSeedsByHerbloreLevel()
    for (const herb of herbs) expect(chances[herb.id]).toBeGreaterThan(0)
    // Ordered by the Herblore level of the potion each herb makes: the herb a
    // Super Combat needs is the rarest reward, the Attack potion's the commonest.
    for (let i = 1; i < herbs.length; i++) {
      expect(chances[herbs[i].id]).toBeLessThan(chances[herbs[i - 1].id])
    }
  })

  it('pays no better per seed than the level-90 thieving target does per steal', () => {
    const expectedValue = Object.entries(masterFarmerChances()).reduce(
      (sum, [id, chance]) => sum + chance * ((itemsData as Record<string, any>)[id].shopValue || 0),
      0,
    )
    const tzraar = (skillsData as any).thieving.npcs.find((n: any) => n.id === 'tzraar')
    const tzraarValue = tzraar.gems.reduce(
      (sum: number, gem: any) => sum + gem.chance * ((itemsData as Record<string, any>)[gem.itemId].shopValue || 0),
      0,
    )
    expect(expectedValue).toBeLessThan(tzraarValue)
  })

  it('makes potato and sweetcorn seeds among the most common rewards', () => {
    const weights = masterFarmerSeedWeights()
    const byId = Object.fromEntries(weights.map((w) => [w.id, w.weight]))
    // Potato ties level-1 Greenthorn; Sweetcorn (level 9) sits just behind them.
    expect(byId.potato_seed).toBe(byId.greenthorn_seed)
    expect(byId.sweetcorn_seed).toBeLessThan(byId.potato_seed)
    // Still far more common than the rest of the herb/tree/fruit ladder.
    expect(byId.sweetcorn_seed).toBeGreaterThan(byId.miremint_seed)
  })

  it('rolls a single seed, biased toward the rng position', () => {
    expect(rollMasterFarmerSeed(() => 0)).toBe('greenthorn_seed')
    expect(rollMasterFarmerSeed(() => 0.999999)).toBe('thornspire_seed')
  })

  it('aggregates rolled seeds into a quantity map', () => {
    const seeds = rollMasterFarmerSeeds(5, () => 0)
    expect(seeds).toEqual({ greenthorn_seed: 5 })
    const total = Object.values(rollMasterFarmerSeeds(20)).reduce((a, b) => a + b, 0)
    expect(total).toBe(20)
  })
})
