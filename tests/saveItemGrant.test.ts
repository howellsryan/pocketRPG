import { describe, it, expect } from 'vitest'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  INVENTORY_SLOTS,
  addItemToSaveInventory,
  buildUpdateSql,
  canonicalItemId,
  countInInventory,
  readInventory,
  resolveItem,
  toHexLiteral,
  toSqlTextLiteral,
} from '../scripts/lib/saveItemGrant.mjs'
import itemsData from '../src/data/items.json'

const items: Record<string, any> = itemsData as any

describe('resolveItem', () => {
  it('resolves by exact id', () => {
    const r = resolveItem(items, 'coins')
    expect(r.itemId).toBe('coins')
    expect(r.matchedBy).toBe('id')
  })

  it('resolves by name, case- and punctuation-insensitively', () => {
    const r = resolveItem(items, items.coins.name.toUpperCase())
    expect(r.itemId).toBe('coins')
  })

  it('resolves a legacy id to its canonical item', () => {
    const legacy = Object.values(items).find((it: any) => it.legacy_item_id && it.legacy_item_id !== it.id) as any
    expect(legacy).toBeTruthy()
    expect(canonicalItemId(items, legacy.legacy_item_id)).toBe(legacy.id)
    expect(resolveItem(items, legacy.legacy_item_id).itemId).toBe(legacy.id)
  })

  it('refuses an unknown item instead of guessing', () => {
    const r = resolveItem(items, 'definitely_not_an_item_zzz')
    expect(r.itemId).toBeUndefined()
    expect(r.error).toContain('No item matches')
  })

  it('refuses an ambiguous query and returns candidates', () => {
    const fake = { a_sword: { id: 'a_sword', name: 'A Sword' }, b_sword: { id: 'b_sword', name: 'B Sword' } }
    const r = resolveItem(fake, 'sword')
    expect(r.itemId).toBeUndefined()
    expect(r.candidates).toHaveLength(2)
  })
})

describe('addItemToSaveInventory', () => {
  it('stacks a stackable item onto the existing slot', () => {
    const save: any = { inventory: [{ itemId: 'coins', quantity: 100 }], bank: { coins: 5 } }
    addItemToSaveInventory(save, 'coins', 50, { stackable: true })
    expect(save.inventory).toEqual([{ itemId: 'coins', quantity: 150 }])
  })

  it('takes one slot per copy of a non-stackable item', () => {
    const save: any = { inventory: [] }
    addItemToSaveInventory(save, 'dragon_scimitar', 3, { stackable: false })
    expect(save.inventory).toHaveLength(3)
    expect(countInInventory(save, 'dragon_scimitar')).toBe(3)
  })

  it('keeps noted and unnoted stacks separate', () => {
    const save: any = { inventory: [{ itemId: 'coins', quantity: 10 }] }
    addItemToSaveInventory(save, 'coins', 5, { stackable: true, noted: true })
    expect(save.inventory).toEqual([
      { itemId: 'coins', quantity: 10 },
      { itemId: 'coins', quantity: 5, noted: true },
    ])
  })

  it('refuses to exceed the 28-slot cap', () => {
    const save: any = { inventory: Array.from({ length: INVENTORY_SLOTS }, (_, i) => ({ itemId: `x${i}`, quantity: 1 })) }
    expect(() => addItemToSaveInventory(save, 'dragon_scimitar', 1, { stackable: false })).toThrow(/Inventory full/)
    expect(() => addItemToSaveInventory(save, 'coins', 1, { stackable: true })).toThrow(/Inventory full/)
    expect(save.inventory).toHaveLength(INVENTORY_SLOTS)
  })

  it('still stacks onto a full inventory when the stack already exists', () => {
    const inv = Array.from({ length: INVENTORY_SLOTS - 1 }, (_, i) => ({ itemId: `x${i}`, quantity: 1 }))
    const save: any = { inventory: [...inv, { itemId: 'coins', quantity: 1 }] }
    addItemToSaveInventory(save, 'coins', 999, { stackable: true })
    expect(countInInventory(save, 'coins')).toBe(1000)
  })

  it('rejects a non-positive quantity', () => {
    const save: any = { inventory: [] }
    expect(() => addItemToSaveInventory(save, 'coins', 0, { stackable: true })).toThrow()
    expect(() => addItemToSaveInventory(save, 'coins', -5, { stackable: true })).toThrow()
  })

  it('adds to the save without disturbing any other field', () => {
    const save: any = {
      stats: { attack: { level: 70, xp: 737627 } },
      bank: { shark: { itemId: 'shark', quantity: 200 }, trident: { itemId: 'trident', quantity: 1, charges: 2500 } },
      equipment: { weapon: { itemId: 'dragon_scimitar' } },
      settings: { autoBankExcludedItems: ['bones'] },
      inventory: [{ itemId: 'shark', quantity: 3 }],
    }
    const before = JSON.parse(JSON.stringify(save))
    addItemToSaveInventory(save, 'coins', 1000, { stackable: true })
    delete before.inventory
    const after = JSON.parse(JSON.stringify(save))
    delete after.inventory
    expect(after).toEqual(before)
    expect(save.inventory).toEqual([
      { itemId: 'shark', quantity: 3 },
      { itemId: 'coins', quantity: 1000 },
    ])
  })

  it('normalizes a null-padded 28-slot inventory to occupied slots', () => {
    const padded = new Array(INVENTORY_SLOTS).fill(null)
    padded[0] = { itemId: 'shark', quantity: 2 }
    const save: any = { inventory: padded }
    addItemToSaveInventory(save, 'coins', 5, { stackable: true })
    expect(save.inventory).toEqual([
      { itemId: 'shark', quantity: 2 },
      { itemId: 'coins', quantity: 5 },
    ])
  })

  it('reads legacy `id`-keyed slots', () => {
    const save: any = { inventory: [{ id: 'shark', quantity: 2 }] }
    expect(readInventory(save)[0].itemId).toBe('shark')
  })
})

describe('SQL encoding', () => {
  it('round-trips a gzipped save through the hex blob literal', () => {
    const json = JSON.stringify({ inventory: [{ itemId: "player's shark", quantity: 1 }] })
    const hex = toHexLiteral(gzipSync(Buffer.from(json, 'utf8')))
    expect(hex).toMatch(/^[0-9A-F]+$/)
    expect(gunzipSync(Buffer.from(hex, 'hex')).toString('utf8')).toBe(json)
  })

  it('escapes single quotes in the text literal', () => {
    expect(toSqlTextLiteral(`a'b`)).toBe(`'a''b'`)
  })

  it('guards the update on the revision it read', () => {
    const sql = buildUpdateSql({ characterId: 12, expectedRevision: 7, blobHex: 'AB', saveJson: '{}', now: 1700000000000 })
    expect(sql).toContain('WHERE character_id = 12 AND save_revision = 7')
    expect(sql).toContain('save_revision = save_revision + 1')
    expect(sql).toContain("save_blob = X'AB'")
  })
})
