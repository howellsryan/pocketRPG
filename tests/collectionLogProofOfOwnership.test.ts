import { describe, it, expect } from 'vitest'
import { collectOwnedItemIds, partitionCollectionLogEntries } from '../functions/api/collection-log.js'

describe('collectOwnedItemIds', () => {
  it('extracts itemIds from inventory, bank, and equipment', () => {
    const save = {
      inventory: [{ itemId: 'shark', quantity: 5 }, { id: 'feather', quantity: 100 }],
      bank: {
        coins: { quantity: 1000 },
        dragon_claws: 1,
        morvyn_s_hood: { itemId: 'morvyn_s_hood', quantity: 1 },
      },
      equipment: {
        weapon: { itemId: 'bronze_dagger' },
        ring: { id: 'archers_ring' },
      },
    }
    const ids = collectOwnedItemIds(JSON.stringify(save))
    expect(ids.has('shark')).toBe(true)
    expect(ids.has('feather')).toBe(true)
    expect(ids.has('coins')).toBe(true)
    expect(ids.has('dragon_claws')).toBe(true)
    expect(ids.has('morvyn_s_hood')).toBe(true)
    expect(ids.has('bronze_dagger')).toBe(true)
    expect(ids.has('archers_ring')).toBe(true)
  })

  it('returns an empty set for a missing or malformed save', () => {
    expect(collectOwnedItemIds(null).size).toBe(0)
    expect(collectOwnedItemIds('').size).toBe(0)
    expect(collectOwnedItemIds('not json').size).toBe(0)
  })
})

describe('partitionCollectionLogEntries (proof of ownership)', () => {
  const stubValidator = (sourceType: string, sourceId: string, itemId: string) =>
    sourceType === 'clues' && sourceId === 'master' && itemId === 'pathfinder_boots'

  it('rejects entries with missing fields as malformed', () => {
    const owned = new Set(['pathfinder_boots'])
    const { accepted, rejected } = partitionCollectionLogEntries(
      [{ itemId: 'pathfinder_boots', sourceType: 'clues' }],
      owned,
      { isValidEntry: stubValidator } as any,
    )
    expect(accepted).toEqual([])
    expect(rejected).toEqual([{ itemId: 'pathfinder_boots', sourceType: 'clues', reason: 'malformed' }])
  })

  it('rejects entries that fail the source whitelist', () => {
    const owned = new Set(['pathfinder_boots'])
    const { accepted, rejected } = partitionCollectionLogEntries(
      [{ itemId: 'pathfinder_boots', sourceType: 'clues', sourceId: 'beginner' }],
      owned,
      { isValidEntry: stubValidator } as any,
    )
    expect(accepted).toEqual([])
    expect(rejected[0]).toMatchObject({ reason: 'invalid_source' })
  })

  it('rejects entries for items the player does not currently own', () => {
    const owned = new Set([] as string[])
    const { accepted, rejected } = partitionCollectionLogEntries(
      [{ itemId: 'pathfinder_boots', sourceType: 'clues', sourceId: 'master' }],
      owned,
      { isValidEntry: stubValidator } as any,
    )
    expect(accepted).toEqual([])
    expect(rejected[0]).toMatchObject({ reason: 'not_owned' })
  })

  it('accepts entries when the player owns the item and source matches', () => {
    const owned = new Set(['pathfinder_boots'])
    const { accepted, rejected } = partitionCollectionLogEntries(
      [{ itemId: 'pathfinder_boots', sourceType: 'clues', sourceId: 'master' }],
      owned,
      { isValidEntry: stubValidator } as any,
    )
    expect(accepted).toEqual([{ itemId: 'pathfinder_boots', sourceType: 'clues', sourceId: 'master' }])
    expect(rejected).toEqual([])
  })
})
