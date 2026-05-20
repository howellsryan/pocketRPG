import { describe, expect, it } from 'vitest'
import { migrateLegacyItemIds } from '../src/engine/itemMigrations.js'

describe('migrateLegacyItemIds', () => {
  it('rewrites legacy void_knight_* equipment itemIds to void_king_*', () => {
    const equipment = {
      head: { itemId: 'void_knight_helm' },
      body: { itemId: 'void_knight_top' },
      legs: { itemId: 'void_knight_robe' },
      gloves: { itemId: 'void_knight_gloves' },
      weapon: { itemId: 'rune_scimitar' },
    }
    const result = migrateLegacyItemIds({ equipment, inventory: [], bank: {} })
    expect(result.changed).toBe(true)
    expect(result.equipment.head.itemId).toBe('void_king_helm')
    expect(result.equipment.body.itemId).toBe('void_king_top')
    expect(result.equipment.legs.itemId).toBe('void_king_robe')
    expect(result.equipment.gloves.itemId).toBe('void_king_gloves')
    expect(result.equipment.weapon.itemId).toBe('rune_scimitar')
  })

  it('preserves other equipment fields (charges, quantity) on the rewritten slot', () => {
    const equipment = {
      gloves: { itemId: 'void_knight_gloves', charges: 7, quantity: 1 },
    }
    const result = migrateLegacyItemIds({ equipment, inventory: [], bank: {} })
    expect(result.equipment.gloves).toEqual({ itemId: 'void_king_gloves', charges: 7, quantity: 1 })
  })

  it('rewrites legacy inventory itemIds and keeps unrelated slots untouched', () => {
    const inventory = [
      { itemId: 'void_knight_helm', quantity: 1 },
      null,
      { itemId: 'coins', quantity: 100 },
      { itemId: 'void_knight_top', quantity: 1 },
    ]
    const result = migrateLegacyItemIds({ equipment: {}, inventory, bank: {} })
    expect(result.changed).toBe(true)
    expect(result.inventory[0]).toEqual({ itemId: 'void_king_helm', quantity: 1 })
    expect(result.inventory[1]).toBeNull()
    expect(result.inventory[2]).toEqual({ itemId: 'coins', quantity: 100 })
    expect(result.inventory[3]).toEqual({ itemId: 'void_king_top', quantity: 1 })
  })

  it('rewrites legacy bank entries, rekeying by new itemId', () => {
    const bank = {
      void_knight_helm: { itemId: 'void_knight_helm', quantity: 1 },
      coins: { itemId: 'coins', quantity: 1000 },
    }
    const result = migrateLegacyItemIds({ equipment: {}, inventory: [], bank })
    expect(result.changed).toBe(true)
    expect(result.bank.void_knight_helm).toBeUndefined()
    expect(result.bank.void_king_helm).toEqual({ itemId: 'void_king_helm', quantity: 1 })
    expect(result.bank.coins).toEqual({ itemId: 'coins', quantity: 1000 })
  })

  it('merges quantities if both the legacy and new bank ids are present', () => {
    const bank = {
      void_knight_top: { itemId: 'void_knight_top', quantity: 1 },
      void_king_top: { itemId: 'void_king_top', quantity: 2 },
    }
    const result = migrateLegacyItemIds({ equipment: {}, inventory: [], bank })
    expect(result.changed).toBe(true)
    expect(result.bank.void_knight_top).toBeUndefined()
    expect(result.bank.void_king_top.quantity).toBe(3)
  })

  it('reports changed=false when nothing legacy is present (idempotent on already-migrated saves)', () => {
    const equipment = { head: { itemId: 'void_king_helm' } }
    const inventory = [{ itemId: 'void_king_top', quantity: 1 }]
    const bank = { void_king_robe: { itemId: 'void_king_robe', quantity: 1 } }
    const result = migrateLegacyItemIds({ equipment, inventory, bank })
    expect(result.changed).toBe(false)
    expect(result.equipment).toBe(equipment)
    expect(result.inventory).toBe(inventory)
    expect(result.bank).toBe(bank)
  })

  it('handles missing containers safely', () => {
    const result = migrateLegacyItemIds({ equipment: null as any, inventory: null as any, bank: null as any })
    expect(result.changed).toBe(false)
  })
})
