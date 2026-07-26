import { describe, expect, it } from 'vitest'
import {
  usesShardglassGatherTool,
  getShardglassToolCharges,
  resolveShardglassToolSource,
  consumeShardglassGatherCharge,
  getEffectiveToolActionTicks,
} from '../src/engine/skilling.js'
import { simulateIdleSkilling } from '../src/engine/idleEngine.js'
import { getBreakdownYield, buyWithShards, countItem } from '../src/engine/inventory.js'
import { getPurchaseRestriction } from '../src/engine/storeRules.js'
import { describeObtainment } from '../src/utils/armoury.js'
import itemsData from '../src/data/items.json'

const shardglassGear = Object.values(itemsData as any).filter(
  (it: any) => typeof it.id === 'string' && it.id.startsWith('shardglass_') && it.id !== 'shardglass_shards',
) as any[]

const toolItems = {
  shardglass_pickaxe: { id: 'shardglass_pickaxe', name: 'Shardglass Pickaxe', toolFor: 'mining', requirements: { mining: 70 }, scaleCharged: true },
  bronze_pickaxe: { id: 'bronze_pickaxe', name: 'Bronze Pickaxe', toolFor: 'mining', requirements: { mining: 1 } },
  shardglass_shards: { id: 'shardglass_shards', name: 'Shardglass Shards', stackable: true },
  adamantite_ore: { id: 'adamantite_ore', name: 'Adamantite Ore' },
} as any

const maxedMining = { mining: { xp: 200_000_000 } } as any

const pad = (slots: any[]) => [...slots, ...Array(28 - slots.length).fill(null)]

describe('shardglass gathering perk — tool detection', () => {
  it('recognises a charged shardglass pickaxe as the mining perk tool', () => {
    const inv = pad([{ itemId: 'shardglass_pickaxe', quantity: 1, charges: 10 }])
    expect(usesShardglassGatherTool('mining', {}, inv, toolItems, maxedMining)).toBe(true)
  })

  it('does not fire for a plain pickaxe, for fishing, or for an uncharged shardglass pickaxe', () => {
    const bronze = pad([{ itemId: 'bronze_pickaxe', quantity: 1 }])
    expect(usesShardglassGatherTool('mining', {}, bronze, toolItems, maxedMining)).toBe(false)
    const shard = pad([{ itemId: 'shardglass_pickaxe', quantity: 1, charges: 10 }])
    expect(usesShardglassGatherTool('fishing', {}, shard, toolItems, maxedMining)).toBe(false)
    const uncharged = pad([{ itemId: 'shardglass_pickaxe', quantity: 1 }])
    expect(usesShardglassGatherTool('mining', {}, uncharged, toolItems, maxedMining)).toBe(false)
  })
})

describe('shardglass gathering perk — charge consumption + doubling', () => {
  it('consumes 2 charges from the tool and doubles the drops when enough are held', () => {
    const drops = { adamantite_ore: 1 }
    expect(consumeShardglassGatherCharge(drops, 5)).toBe(3)
    expect(drops.adamantite_ore).toBe(2)
  })

  it('leaves output single and charges untouched with fewer than 2 charges', () => {
    const drops = { adamantite_ore: 1 }
    expect(consumeShardglassGatherCharge(drops, 1)).toBe(1)
    expect(drops.adamantite_ore).toBe(1)
  })

  it('drains to zero when the last pair of charges is spent', () => {
    const drops = { adamantite_ore: 1 }
    expect(consumeShardglassGatherCharge(drops, 2)).toBe(0)
    expect(drops.adamantite_ore).toBe(2)
  })

  it('never touches loose shardglass shards sitting in the inventory — charges live on the tool', () => {
    const inv = pad([{ itemId: 'shardglass_shards', quantity: 10 }])
    const drops = { adamantite_ore: 1 }
    consumeShardglassGatherCharge(drops, 4)
    expect(inv.find((s) => s?.itemId === 'shardglass_shards')?.quantity).toBe(10)
  })

  it('reads charges off the equipped tool, falling back to the matching inventory slot', () => {
    const equipped = { weapon: { itemId: 'shardglass_pickaxe', charges: 7 } } as any
    expect(getShardglassToolCharges('mining', equipped, [])).toBe(7)
    const held = pad([{ itemId: 'shardglass_pickaxe', quantity: 1, charges: 3 }])
    expect(getShardglassToolCharges('mining', {}, held)).toBe(3)
    expect(getShardglassToolCharges('mining', {}, pad([]))).toBe(0)
  })

  it('falls back to a charged inventory spare when the equipped copy is empty', () => {
    const equipment = { weapon: { itemId: 'shardglass_pickaxe', charges: 0 } } as any
    const inv = pad([{ itemId: 'shardglass_pickaxe', quantity: 1, charges: 5 }])
    const source = resolveShardglassToolSource('mining', equipment, inv)
    expect(source).toMatchObject({ equipped: false, charges: 5, inventoryIndex: 0 })
  })
})

describe('shardglass gathering perk — idle simulation', () => {
  const miningAction = { id: 'adamantite', name: 'Mine Adamantite', level: 70, ticks: 4, xp: 95, product: 'adamantite_ore' }
  // Derive per-action ticks from a fully-charged pickaxe so the elapsed budget
  // stays correct even as the tool's speed multiplier changes.
  const pickaxeInv = pad([{ itemId: 'shardglass_pickaxe', quantity: 1, charges: 100 }])
  const actionTicks = getEffectiveToolActionTicks('mining', miningAction.ticks, {}, itemsData as any, maxedMining, pickaxeInv)
  const msForActions = (n: number) => n * actionTicks * 600

  it('doubles idle ore and drains 2 tool charges per action while charges last (inventory-held)', () => {
    const inv = pad([{ itemId: 'shardglass_pickaxe', quantity: 1, charges: 4 }])
    // 3 actions worth of ticks; only 2 actions can be doubled (4 charges / 2).
    const elapsedMs = msForActions(3)
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
    // All 4 charges consumed; the tool itself survives with 0 charges left.
    const pickaxe = sim.finalInventory.find((s: any) => s?.itemId === 'shardglass_pickaxe')
    expect(pickaxe.charges).toBe(0)
    // Charges never come from loose inventory shards.
    expect(sim.itemsGained.shardglass_shards).toBeUndefined()
  })

  it('drains charges from the equipped pickaxe and reports chargesConsumed, when equipped', () => {
    const equipment = { weapon: { itemId: 'shardglass_pickaxe', charges: 4 } } as any
    const elapsedMs = msForActions(3)
    const sim = simulateIdleSkilling(
      { skill: 'mining', action: miningAction } as any,
      elapsedMs,
      {},
      equipment,
      maxedMining,
      itemsData as any,
      pad([]),
      {},
    ) as any

    expect(sim.itemsGained.adamantite_ore).toBe(5)
    expect(sim.chargesConsumed).toBe(4)
  })

  it('does not double when the shardglass pickaxe has too few charges to fire', () => {
    const inv = pad([{ itemId: 'shardglass_pickaxe', quantity: 1, charges: 1 }])
    const elapsedMs = msForActions(2)
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

describe('shardglass tool mining speed', () => {
  it('mines at the same speed as the dragon pickaxe when charged', () => {
    const maxed = { mining: { xp: 200_000_000 } } as any
    const shardTicks = getEffectiveToolActionTicks('mining', 6, {}, itemsData as any, maxed, pad([{ itemId: 'shardglass_pickaxe', quantity: 1, charges: 10 }]))
    const dragonTicks = getEffectiveToolActionTicks('mining', 6, {}, itemsData as any, maxed, pad([{ itemId: 'dragon_pickaxe', quantity: 1 }]))
    expect(shardTicks).toBe(dragonTicks)
    expect(shardTicks).toBeLessThan(6)
  })

  it('loses its speed bonus entirely once out of charges — same as holding no tool at all', () => {
    const maxed = { mining: { xp: 200_000_000 } } as any
    const noToolTicks = getEffectiveToolActionTicks('mining', 6, {}, itemsData as any, maxed, pad([]))
    const unchargedTicks = getEffectiveToolActionTicks('mining', 6, {}, itemsData as any, maxed, pad([{ itemId: 'shardglass_pickaxe', quantity: 1, charges: 0 }]))
    expect(unchargedTicks).toBe(noToolTicks)
  })
})

describe('shardglass tools mirror their dragon counterparts in combat', () => {
  const combatKeys = ['attackSpeed', 'attackStyle', 'attackBonus', 'defenceBonus', 'otherBonus', 'twoHanded'] as const
  const pairs: [string, string][] = [
    ['shardglass_pickaxe', 'dragon_pickaxe'],
    ['shardglass_axe', 'dragon_axe'],
  ]

  it.each(pairs)('%s wields exactly like %s', (shardId, dragonId) => {
    const shard = (itemsData as any)[shardId]
    const dragon = (itemsData as any)[dragonId]
    expect(shard.type).toBe('weapon')
    for (const key of combatKeys) {
      expect(shard[key]).toEqual(dragon[key])
    }
    // Still a wieldable weapon gated on attack, and still its own gathering tier.
    expect(shard.requirements.attack).toBe(dragon.requirements.attack)
    expect(shard.toolFor).toBe(dragon.toolFor)
  })
})

describe('shardglass items charge with shardglass shards, never venom scales', () => {
  it.each(shardglassGear.filter((it) => it.scaleCharged).map((it) => [it.id, it]))(
    '%s charges with shardglass_shards',
    (_id, item: any) => {
      expect(item.chargeItemId).toBe('shardglass_shards')
    },
  )
})

describe('breaking shardglass gear down into shards', () => {
  const breakable = shardglassGear.filter((it) => it.breakdownResult)

  it.each(breakable.map((it) => [it.id, it]))(
    '%s breaks down into 5000 shardglass shards',
    (_id, item: any) => {
      expect(getBreakdownYield(item)).toEqual({ itemId: 'shardglass_shards', qty: 5000 })
    },
  )

  it('returns null for an item that declares no breakdown', () => {
    expect(getBreakdownYield((itemsData as any).coins)).toBeNull()
    expect(getBreakdownYield((itemsData as any).shardglass_shards)).toBeNull()
  })

  // A coin-priced item that breaks down mints its yield out of coins: buy the
  // Shardglass Bow from the quest shop for 300k, break it for 5000 shards.
  it('never lets a coin-purchasable item break down', () => {
    const offenders = Object.values(itemsData as any)
      .filter((it: any) => getBreakdownYield(it) && getPurchaseRestriction(it).allowed)
      .map((it: any) => it.id)
    expect(offenders).toEqual([])
  })

  it('keeps the quest-shop shardglass bow and shield out of the breakdown path', () => {
    expect(getBreakdownYield((itemsData as any).shardglass_bow)).toBeNull()
    expect(getBreakdownYield((itemsData as any).shardglass_shield)).toBeNull()
  })
})

describe('shardglass store prices', () => {
  // The Shardglass Bow and Shield are quest-only unlocks — kept out of the
  // shard store. The elven warweapons (Faerdhinen Warbow, Saeldor Warblade)
  // are the 50k-shard weapon offering instead.
  const expected: Record<string, number> = {
    shardglass_helmet: 25000,
    shardglass_plate_body: 25000,
    shardglass_platelegs: 25000,
    bow_of_faerdhinen: 50000,
    blade_of_saeldor: 50000,
    shardglass_pickaxe: 15000,
    shardglass_axe: 15000,
  }

  it('prices every shardglass gear piece: 25k armour, 50k weapon, 15k tools', () => {
    for (const [id, cost] of Object.entries(expected)) {
      expect((itemsData as any)[id].shardglassShopCost).toBe(cost)
    }
  })

  it('only shardglass gear carries a shard price', () => {
    const priced = Object.values(itemsData as any).filter((it: any) => it.shardglassShopCost).map((it: any) => it.id).sort()
    expect(priced).toEqual(Object.keys(expected).sort())
  })
})

describe('buying shardglass gear with shards', () => {
  const helmet = { id: 'shardglass_helmet', shardglassShopCost: 25000 } as any
  const invWith = (shards: number) => [{ itemId: 'shardglass_shards', quantity: shards }, ...Array(27).fill(null)]

  it('spends the shard cost and grants the gear', () => {
    const res = buyWithShards(invWith(60000), helmet, 2)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.totalCost).toBe(50000)
    expect(countItem(res.inventory, 'shardglass_shards')).toBe(10000)
    expect(countItem(res.inventory, 'shardglass_helmet')).toBe(2)
  })

  it('refuses when the player cannot afford the total', () => {
    const res = buyWithShards(invWith(10000), helmet, 1)
    expect(res).toMatchObject({ ok: false, reason: 'insufficient_shards' })
  })

  it('refuses when there is no inventory room for the gear', () => {
    // Shards left over after the buy keep slot 0 occupied; the other 27 are full.
    const full = [{ itemId: 'shardglass_shards', quantity: 30000 }, ...Array(27).fill({ itemId: 'coins', quantity: 1 })]
    const res = buyWithShards(full, helmet, 1)
    expect(res).toMatchObject({ ok: false, reason: 'no_space' })
  })

  it('never mutates the inventory passed in', () => {
    const inv = invWith(25000)
    buyWithShards(inv, helmet, 1)
    expect(inv[0]).toEqual({ itemId: 'shardglass_shards', quantity: 25000 })
  })

  it('rejects items with no shard price', () => {
    expect(buyWithShards(invWith(99999), { id: 'coins' } as any, 1)).toMatchObject({ ok: false, reason: 'not_for_sale' })
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
