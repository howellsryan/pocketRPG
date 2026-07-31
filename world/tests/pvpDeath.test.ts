import { describe, expect, it } from 'vitest'
import { collectDeathDrops } from '../server/pvpDeath'
import { isVisibleTo, mayTake, spawnDrops, type LootEntity, type LootViewer } from '../server/loot'
import { consumeUnits, emptyPools, drainForFlush } from '../server/sessionItems'
import type { InvSlot } from '../shared/protocol'

const pack = (...slots: ({ itemId: string; quantity: number } | null)[]): InvSlot[] => {
  const out: InvSlot[] = new Array<InvSlot>(28).fill(null)
  slots.forEach((s, i) => { out[i] = s })
  return out
}

describe('collectDeathDrops', () => {
  it('drops the pack AND everything worn', () => {
    const { drops } = collectDeathDrops(
      pack({ itemId: 'shark', quantity: 5 }),
      { weapon: { itemId: 'dragon_scimitar' }, body: { itemId: 'rune_platebody' } },
    )
    expect(drops).toEqual(expect.arrayContaining([
      { itemId: 'shark', quantity: 5 },
      { itemId: 'dragon_scimitar', quantity: 1 },
      { itemId: 'rune_platebody', quantity: 1 },
    ]))
    expect(drops).toHaveLength(3)
  })

  it('merges the same item across slots into one pile', () => {
    const { drops } = collectDeathDrops(
      pack({ itemId: 'coins', quantity: 100 }, null, { itemId: 'coins', quantity: 250 }),
      {},
    )
    expect(drops).toEqual([{ itemId: 'coins', quantity: 350 }])
  })

  it('carries a worn stack quantity (ammo) rather than dropping one arrow', () => {
    const { drops } = collectDeathDrops(pack(), { ammo: { itemId: 'rune_arrow', quantity: 412 } })
    expect(drops).toEqual([{ itemId: 'rune_arrow', quantity: 412 }])
  })

  it('reports only the PACK as pool-drainable — worn gear leaves via the equipment snapshot', () => {
    const { fromPack } = collectDeathDrops(
      pack({ itemId: 'shark', quantity: 2 }),
      { weapon: { itemId: 'dragon_scimitar' } },
    )
    // Draining the sword here as well would take it off the save twice: once
    // from the pool and once from the emptied equipment snapshot.
    expect(fromPack).toEqual([{ itemId: 'shark', quantity: 2 }])
  })

  it('drops nothing for a player carrying and wearing nothing', () => {
    expect(collectDeathDrops(pack(), {}).drops).toEqual([])
  })

  it('converts a carried untradeable to its coin value instead of putting it on the floor', () => {
    const { drops } = collectDeathDrops(pack({ itemId: 'slayer_helmet', quantity: 1 }), {})
    expect(drops).toEqual([{ itemId: 'coins', quantity: 1_000_000 }])
  })

  it('converts a WORN untradeable too — the rule is the item, not the slot', () => {
    const { drops } = collectDeathDrops(pack(), { head: { itemId: 'slayer_helmet' } })
    expect(drops).toEqual([{ itemId: 'coins', quantity: 1_000_000 }])
  })

  it('folds converted value into the coins the player was already carrying', () => {
    const { drops } = collectDeathDrops(
      pack({ itemId: 'coins', quantity: 500 }, { itemId: 'zesta_longsword', quantity: 1 }),
      {},
    )
    expect(drops).toEqual([{ itemId: 'coins', quantity: 120_500 }])
  })

  it('destroys a worthless untradeable rather than dropping a zero-coin pile', () => {
    const { drops } = collectDeathDrops(pack({ itemId: 'fire_cape', quantity: 1 }), {})
    expect(drops).toEqual([])
  })

  it('leaves tradeable gear alone while converting the untradeables beside it', () => {
    const { drops } = collectDeathDrops(
      pack({ itemId: 'shark', quantity: 3 }),
      { weapon: { itemId: 'dragon_scimitar' }, head: { itemId: 'slayer_helmet' } },
    )
    expect(drops).toEqual(expect.arrayContaining([
      { itemId: 'shark', quantity: 3 },
      { itemId: 'dragon_scimitar', quantity: 1 },
      { itemId: 'coins', quantity: 1_000_000 },
    ]))
    expect(drops).toHaveLength(3)
  })

  it('still drains the pools by the REAL item id of a converted untradeable', () => {
    // fromPack feeds consumeUnits. Converting it here would remove coins the
    // player never had and leave the helmet sitting in the save.
    const { fromPack } = collectDeathDrops(pack({ itemId: 'slayer_helmet', quantity: 1 }), {})
    expect(fromPack).toEqual([{ itemId: 'slayer_helmet', quantity: 1 }])
  })
})

describe('death drops against the provenance pools', () => {
  it('records save-backed pack units as removals so the save actually loses them', () => {
    const pools = emptyPools({ shark: 3 })
    const { fromPack } = collectDeathDrops(pack({ itemId: 'shark', quantity: 3 }), {})
    for (const stack of fromPack) consumeUnits(pools, stack.itemId, stack.quantity)
    const drained = drainForFlush(pools, 'timer')
    expect(drained.removeFromInventory).toEqual([{ itemId: 'shark', quantity: 3 }])
    expect(drained.items).toEqual([])
  })

  it('lets a world-minted unit die without touching the save', () => {
    const pools = emptyPools({})
    pools.minted.coins = 500
    const { fromPack } = collectDeathDrops(pack({ itemId: 'coins', quantity: 500 }), {})
    for (const stack of fromPack) consumeUnits(pools, stack.itemId, stack.quantity)
    const drained = drainForFlush(pools, 'timer')
    // Never granted, so there is nothing to remove — it simply stops being minted.
    expect(drained.items).toEqual([])
    expect(drained.removeFromInventory).toEqual([])
  })
})

const iron = (charId: string): LootViewer => ({ charId, isIronman: true })
const main = (charId: string): LootViewer => ({ charId, isIronman: false })

describe('Ironman and Wilderness loot', () => {
  const playerDrop = (): LootEntity =>
    spawnDrops([{ itemId: 'dragon_scimitar', quantity: 1 }], 5, 5, 'killer', 0, 17, { fromPlayer: true })[0]
  const botDrop = (): LootEntity =>
    spawnDrops([{ itemId: 'zesta_longsword', quantity: 1 }], 5, 5, 'killer', 0)[0]

  it('refuses an Ironman the loot of a player they killed themselves', () => {
    const drop = playerDrop()
    expect(drop.ownerCharId).toBe('killer')
    expect(mayTake(drop, iron('killer'))).toBe(false)
    expect(isVisibleTo(drop, iron('killer'), 1)).toBe(false)
  })

  it('lets a non-Ironman killer take it as normal', () => {
    expect(mayTake(playerDrop(), main('killer'))).toBe(true)
    expect(isVisibleTo(playerDrop(), main('killer'), 1)).toBe(true)
  })

  it('grants an Ironman their own bot drop, Zesta included', () => {
    const drop = botDrop()
    expect(mayTake(drop, iron('killer'))).toBe(true)
    expect(isVisibleTo(drop, iron('killer'), 1)).toBe(true)
  })

  it('still refuses an Ironman a bot drop somebody ELSE earned', () => {
    const drop = botDrop()
    expect(mayTake(drop, iron('bystander'))).toBe(false)
  })

  it('keeps a player drop out of an Ironman bystander’s view once it goes public', () => {
    const drop = playerDrop()
    // Past the owner window it is public to everyone else — but never to them.
    expect(isVisibleTo(drop, main('bystander'), 100)).toBe(true)
    expect(isVisibleTo(drop, iron('bystander'), 100)).toBe(false)
  })
})
