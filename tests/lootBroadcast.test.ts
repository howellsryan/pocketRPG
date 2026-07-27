import { describe, it, expect } from 'vitest'
import { coopEpicDropEvents, epicDropsFrom } from '../src/engine/lootBroadcast.js'
import { hasEpicLootDrop } from '../src/utils/itemValue.js'
import itemsData from '../src/data/items.json'

// The broadcast exists to mirror the purple loot modal, so its predicate must
// agree with the modal's — the drop the winner sees celebrated is the drop the
// room is told about.
describe('epicDropsFrom', () => {
  it('agrees with the purple-modal predicate on the same loot', () => {
    const loot = [{ itemId: 'onyx', quantity: 1 }, { itemId: 'bones', quantity: 3 }]
    expect(hasEpicLootDrop(loot, itemsData)).toBe(true)
    expect(epicDropsFrom(loot, itemsData)).toEqual(['onyx'])
  })

  it('ignores a huge stack of cheap items — value is per item, not per pile', () => {
    const loot = [{ itemId: 'bones', quantity: 500_000 }, { itemId: 'coins', quantity: 5_000_000 }]
    expect(hasEpicLootDrop(loot, itemsData)).toBe(false)
    expect(epicDropsFrom(loot, itemsData)).toEqual([])
  })

  it('announces each item once however many rolled', () => {
    expect(epicDropsFrom([
      { itemId: 'onyx', quantity: 1 },
      { itemId: 'onyx', quantity: 1 },
    ], itemsData)).toEqual(['onyx'])
  })

  it('survives empty, missing and malformed loot', () => {
    expect(epicDropsFrom([], itemsData)).toEqual([])
    expect(epicDropsFrom(null as never, itemsData)).toEqual([])
    expect(epicDropsFrom([null, { quantity: 2 }] as never, itemsData)).toEqual([])
    expect(epicDropsFrom([{ itemId: 'not_a_real_item', quantity: 1 }], itemsData)).toEqual([])
  })
})

describe('coopEpicDropEvents', () => {
  const members = { 7: { characterId: 7, username: 'player7' }, 8: { characterId: 8, username: 'player8' } }

  it('announces one event per winner per legendary item, naming who got what', () => {
    const events = coopEpicDropEvents({
      shares: [
        { characterId: 7, granted: [{ itemId: 'onyx', quantity: 1 }, { itemId: 'bones', quantity: 1 }] },
        { characterId: 8, granted: [{ itemId: 'bones', quantity: 1 }] },
      ],
      members,
      bossName: 'Warlord Grondar',
      tick: 42,
      itemsData,
    })
    expect(events).toEqual([{
      type: 'epicDrop', tick: 42, characterId: 7, username: 'player7',
      item: itemsData.onyx.name, monster: 'Warlord Grondar',
    }])
  })

  it('carries the legendary item only — the rest of the winner’s drops stay private', () => {
    const events = coopEpicDropEvents({
      shares: [{ characterId: 7, granted: [{ itemId: 'onyx', quantity: 1 }, { itemId: 'zyrite', quantity: 1 }] }],
      members,
      bossName: 'Boss',
      tick: 1,
      itemsData,
    })
    const announced = events.map((e) => e.item).sort()
    expect(announced).toEqual([itemsData.onyx.name, itemsData.zyrite.name].sort())
    expect(events.every((e) => !('granted' in e))).toBe(true)
  })

  it('says nothing for a settlement that failed — nobody received anything', () => {
    expect(coopEpicDropEvents({
      shares: [{ characterId: 7, granted: [{ itemId: 'onyx', quantity: 1 }], failed: true }],
      members, bossName: 'Boss', tick: 1, itemsData,
    })).toEqual([])
  })

  it('falls back to a placeholder name for a member who has already left', () => {
    const events = coopEpicDropEvents({
      shares: [{ characterId: 99, granted: [{ itemId: 'onyx', quantity: 1 }] }],
      members, bossName: 'Boss', tick: 1, itemsData,
    })
    expect(events[0].username).toBe('Someone')
  })

  it('says nothing when no share cleared the threshold', () => {
    expect(coopEpicDropEvents({
      shares: [{ characterId: 7, granted: [{ itemId: 'bones', quantity: 9 }] }],
      members, bossName: 'Boss', tick: 1, itemsData,
    })).toEqual([])
    expect(coopEpicDropEvents({ shares: [], members, bossName: 'Boss', tick: 1, itemsData })).toEqual([])
  })
})
