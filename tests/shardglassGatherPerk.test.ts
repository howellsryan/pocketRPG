import { describe, expect, it } from 'vitest'
import {
  usesShardglassGatherTool,
  consumeShardglassGatherDouble,
} from '../src/engine/skilling.js'
import { simulateIdleSkilling } from '../src/engine/idleEngine.js'
import { describeObtainment } from '../src/utils/armoury.js'
import itemsData from '../src/data/items.json'

const toolItems = {
  shardglass_pickaxe: { id: 'shardglass_pickaxe', name: 'Shardglass Pickaxe', toolFor: 'mining', requirements: { mining: 70 } },
  bronze_pickaxe: { id: 'bronze_pickaxe', name: 'Bronze Pickaxe', toolFor: 'mining', requirements: { mining: 1 } },
  shardglass_shards: { id: 'shardglass_shards', name: 'Shardglass Shards', stackable: true },
  adamantite_ore: { id: 'adamantite_ore', name: 'Adamantite Ore' },
} as any

const maxedMining = { mining: { xp: 200_000_000 } } as any

const pad = (slots: any[]) => [...slots, ...Array(28 - slots.length).fill(null)]

describe('shardglass gathering perk — tool detection', () => {
  it('recognises the shardglass pickaxe as the mining perk tool', () => {
    const inv = pad([{ itemId: 'shardglass_pickaxe', quantity: 1 }])
    expect(usesShardglassGatherTool('mining', {}, inv, toolItems, maxedMining)).toBe(true)
  })

  it('does not fire for a plain pickaxe or for fishing', () => {
    const bronze = pad([{ itemId: 'bronze_pickaxe', quantity: 1 }])
    expect(usesShardglassGatherTool('mining', {}, bronze, toolItems, maxedMining)).toBe(false)
    const shard = pad([{ itemId: 'shardglass_pickaxe', quantity: 1 }])
    expect(usesShardglassGatherTool('fishing', {}, shard, toolItems, maxedMining)).toBe(false)
  })
})

describe('shardglass gathering perk — shard consumption + doubling', () => {
  it('consumes 2 shards and doubles the drops when shards are held', () => {
    const inv = pad([{ itemId: 'shardglass_shards', quantity: 5 }])
    const drops = { adamantite_ore: 1 }
    expect(consumeShardglassGatherDouble(drops, inv)).toBe(true)
    expect(drops.adamantite_ore).toBe(2)
    const shards = inv.find((s) => s?.itemId === 'shardglass_shards')
    expect(shards.quantity).toBe(3)
  })

  it('leaves output single and shards untouched with fewer than 2 shards', () => {
    const inv = pad([{ itemId: 'shardglass_shards', quantity: 1 }])
    const drops = { adamantite_ore: 1 }
    expect(consumeShardglassGatherDouble(drops, inv)).toBe(false)
    expect(drops.adamantite_ore).toBe(1)
    expect(inv.find((s) => s?.itemId === 'shardglass_shards').quantity).toBe(1)
  })

  it('clears the shard slot when the last pair is spent', () => {
    const inv = pad([{ itemId: 'shardglass_shards', quantity: 2 }])
    consumeShardglassGatherDouble({ adamantite_ore: 1 }, inv)
    expect(inv.find((s) => s?.itemId === 'shardglass_shards')).toBeUndefined()
  })
})

describe('shardglass gathering perk — idle simulation', () => {
  const miningAction = { id: 'adamantite', name: 'Mine Adamantite', level: 70, ticks: 4, xp: 95, product: 'adamantite_ore' }

  it('doubles idle ore and burns 2 shards per action while shards last', () => {
    const inv = pad([
      { itemId: 'shardglass_pickaxe', quantity: 1 },
      { itemId: 'shardglass_shards', quantity: 4 },
    ])
    // 3 actions worth of ticks; only 2 actions can be doubled (4 shards / 2).
    const elapsedMs = 3 * 4 * 600
    const sim = simulateIdleSkilling(
      { skill: 'mining', action: miningAction } as any,
      elapsedMs,
      {},
      {},
      maxedMining,
      itemsData as any,
      inv,
      {},
    ) as any

    // 2 doubled actions (2 ore each) + 1 single action = 5 ore.
    expect(sim.itemsGained.adamantite_ore).toBe(5)
    // All 4 shards consumed; the slot survives (excluded from auto-bank) but empties.
    const finalShards = sim.finalInventory.find((s: any) => s?.itemId === 'shardglass_shards')
    expect(finalShards == null || finalShards.quantity === 0).toBe(true)
    // Shards are never reported as a gain.
    expect(sim.itemsGained.shardglass_shards).toBeUndefined()
  })

  it('does not double when the player holds no shards', () => {
    const inv = pad([{ itemId: 'shardglass_pickaxe', quantity: 1 }])
    const elapsedMs = 2 * 4 * 600
    const sim = simulateIdleSkilling(
      { skill: 'mining', action: miningAction } as any,
      elapsedMs,
      {},
      {},
      maxedMining,
      itemsData as any,
      inv,
      {},
    ) as any
    expect(sim.itemsGained.adamantite_ore).toBe(2)
  })
})

describe('visage shield combine recipe', () => {
  it('forges the visage shield from the dragon visage + anti-dragon shield + 10m coins', () => {
    const visage = (itemsData as any).dragon_visage
    expect(visage.combineWith).toBe('anti_dragon_shield')
    expect(visage.combineResult).toBe('visage_shield')
    expect(visage.combineCost).toBe(10_000_000)
  })

  it('surfaces the coin cost in the visage shield obtainment text', () => {
    const lines = describeObtainment((itemsData as any).visage_shield, { items: itemsData })
    expect(lines.some((l: string) => /Dragon Visage/.test(l) && /10,000,000 coins/.test(l))).toBe(true)
  })
})
