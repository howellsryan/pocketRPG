import { describe, it, expect } from 'vitest'
import monstersData from '../src/data/monsters.json'
import itemsData from '../src/data/items.json'

const isSeedDrop = (drop: any) => (itemsData as any)[drop.itemId]?.type === 'seed'

const slayerMonsters = Object.values(monstersData as Record<string, any>)
  .filter((m) => m.slayerRequirement > 0)

describe('slayer monster seed/sapling drops', () => {
  it('every slayer-locked monster drops seeds and saplings', () => {
    expect(slayerMonsters.length).toBeGreaterThan(0)
    for (const monster of slayerMonsters) {
      const seeds = (monster.drops || []).filter(isSeedDrop)
      expect(seeds.length, monster.id).toBeGreaterThanOrEqual(4)
    }
  })

  it('seed tiers scale with slayer requirement', () => {
    for (const monster of slayerMonsters) {
      const seedIds = new Set((monster.drops || []).filter(isSeedDrop).map((d: any) => d.itemId))
      if (monster.slayerRequirement < 35 && !monster.boss) {
        // High-tier seeds stay off low-tier tables (warped_spectre keeps its
        // long-standing rynarr drop; it sits at slayer 60 anyway).
        expect(seedIds.has('rynarr_seed'), monster.id).toBe(false)
        expect(seedIds.has('magic_sapling'), monster.id).toBe(false)
        expect(seedIds.has('palm_sapling'), monster.id).toBe(false)
      }
      if (monster.slayerRequirement >= 75 || monster.boss) {
        expect(seedIds.has('magic_sapling'), monster.id).toBe(true)
        expect(seedIds.has('rynarr_seed'), monster.id).toBe(true)
      }
    }
  })

  it('seed drop rates stay within sane bounds', () => {
    for (const monster of slayerMonsters) {
      const seeds = (monster.drops || []).filter(isSeedDrop)
      const total = seeds.reduce((sum: number, d: any) => sum + d.chance, 0)
      expect(total, monster.id).toBeLessThanOrEqual(0.16)
      for (const drop of seeds) {
        expect(drop.chance, `${monster.id} ${drop.itemId}`).toBeGreaterThan(0)
        expect(drop.chance, `${monster.id} ${drop.itemId}`).toBeLessThanOrEqual(0.05)
        // The valuable late-game plants stay rare everywhere.
        if (drop.itemId === 'magic_sapling') expect(drop.chance, monster.id).toBeLessThanOrEqual(0.008)
        if (drop.itemId === 'rynarr_seed' && !monster.boss) expect(drop.chance, monster.id).toBeLessThanOrEqual(0.04)
      }
    }
  })
})
