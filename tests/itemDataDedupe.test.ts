import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'
import { canonicalItemId } from '../functions/_lib/game/inventory.js'

const items = itemsData as Record<string, any>

// After the post-migration cleanup, items.json holds exactly one entry per
// canonical item (no legacy-keyed duplicates). Legacy ids resolve via the
// `legacy_item_id` field instead of a duplicate entry.
describe('items.json has no migration duplicates', () => {
  it('every entry is keyed by its own canonical id (no legacy-keyed entries)', () => {
    const offenders = Object.keys(items).filter(k => items[k].id !== k)
    expect(offenders, `legacy-keyed entries remain: ${offenders.join(', ')}`).toEqual([])
  })

  it('no .id value appears under more than one key', () => {
    const byId: Record<string, string[]> = {}
    for (const k of Object.keys(items)) (byId[items[k].id] ||= []).push(k)
    const dups = Object.entries(byId).filter(([, ks]) => ks.length > 1)
    expect(dups.map(([id]) => id), 'duplicate ids present').toEqual([])
  })

  it('legacy_item_id reverse map is unambiguous and never shadows a live key', () => {
    const seen = new Map<string, string>()
    for (const k of Object.keys(items)) {
      const legacy = items[k].legacy_item_id
      if (typeof legacy !== 'string' || !legacy || legacy === items[k].id) continue
      expect(seen.has(legacy), `legacy_item_id collision: ${legacy}`).toBe(false)
      seen.set(legacy, items[k].id)
      // A removed legacy id must not also still exist as a live key.
      expect(items[legacy], `legacy id ${legacy} still exists as a live entry`).toBeUndefined()
    }
  })
})

describe('canonicalItemId resolves legacy ids via legacy_item_id', () => {
  it('maps known pre-migration ids to their canonical id', () => {
    expect(canonicalItemId(items, 'rune_scimitar')).toBe('runeforged_scimitar')
    expect(canonicalItemId(items, 'saradomin_brew')).toBe('lumira_brew')
    expect(canonicalItemId(items, 'giant_seaweed')).toBe('seaweed')
  })

  it('returns canonical ids unchanged and leaves unknown ids alone', () => {
    expect(canonicalItemId(items, 'runeforged_scimitar')).toBe('runeforged_scimitar')
    expect(canonicalItemId(items, 'coins')).toBe('coins')
    expect(canonicalItemId(items, 'not_a_real_item')).toBe('not_a_real_item')
  })
})
