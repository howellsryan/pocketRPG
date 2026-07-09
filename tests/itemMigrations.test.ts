import { describe, expect, it } from 'vitest'
import { migrateLegacyItemIds } from '../src/engine/itemMigrations.js'

describe('migrateLegacyItemIds', () => {
  it('rewrites legacy void_knight_* equipment itemIds to void_king_*', () => {
    const equipment = {
      head: { itemId: 'void_knight_helm' },
      body: { itemId: 'void_knight_top' },
      legs: { itemId: 'void_knight_robe' },
      gloves: { itemId: 'void_knight_gloves' },
      ring: { itemId: 'coins' },
    }
    const result = migrateLegacyItemIds({ equipment, inventory: [], bank: {} })
    expect(result.changed).toBe(true)
    expect(result.equipment.head.itemId).toBe('void_king_helm')
    expect(result.equipment.body.itemId).toBe('void_king_top')
    expect(result.equipment.legs.itemId).toBe('void_king_robe')
    expect(result.equipment.gloves.itemId).toBe('void_king_gloves')
    expect(result.equipment.ring.itemId).toBe('coins') // canonical id untouched
  })

  it('rewrites pre-migration ids derived from legacy_item_id (post-dedupe)', () => {
    // The legacy-keyed duplicate items were removed from items.json; the map
    // is now derived from each canonical entry's `legacy_item_id` field, so an
    // old save id resolves to its canonical id on load.
    const equipment = { weapon: { itemId: 'rune_scimitar' } }
    const inventory = [{ itemId: 'saradomin_brew', quantity: 3 }]
    const result = migrateLegacyItemIds({ equipment, inventory, bank: {} })
    expect(result.changed).toBe(true)
    expect(result.equipment.weapon.itemId).toBe('runeforged_scimitar')
    expect(result.inventory[0]).toEqual({ itemId: 'lumira_brew', quantity: 3 })
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

  it('preserves pooled charges when merging legacy and new-id bank entries for a scale-charged weapon', () => {
    // Regression: venom_blowpipe (legacy toxic_blowpipe), trident_of_venom
    // (legacy trident_of_the_swamp), shadow_of_tumaken (legacy tumekens_shadow)
    // and scythe_of_vythar (legacy scythe_of_vitur) were all renamed. A player
    // holding a charged copy banked under the old id plus another copy banked
    // under the new id used to have the old copy's charge pool silently
    // dropped by the merge (only quantity was summed).
    const bank = {
      toxic_blowpipe: { itemId: 'toxic_blowpipe', quantity: 1, charges: 500 },
      venom_blowpipe: { itemId: 'venom_blowpipe', quantity: 1, charges: 120 },
    }
    const result = migrateLegacyItemIds({ equipment: {}, inventory: [], bank })
    expect(result.changed).toBe(true)
    expect(result.bank.toxic_blowpipe).toBeUndefined()
    expect(result.bank.venom_blowpipe).toEqual({ itemId: 'venom_blowpipe', quantity: 2, charges: 620 })
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

  it('rewrites retired void_* gear to the current void_king_* set', () => {
    const equipment = { head: { itemId: 'void_hat' } }
    const inventory = [{ itemId: 'void_body', quantity: 1 }, { itemId: 'void_bottoms', quantity: 1 }]
    const bank = { void_gloves: { itemId: 'void_gloves', quantity: 1 } }
    const result = migrateLegacyItemIds({ equipment, inventory, bank })
    expect(result.changed).toBe(true)
    expect(result.equipment.head.itemId).toBe('void_king_helm')
    expect(result.inventory[0]).toEqual({ itemId: 'void_king_top', quantity: 1 })
    expect(result.inventory[1]).toEqual({ itemId: 'void_king_robe', quantity: 1 })
    expect(result.bank.void_gloves).toBeUndefined()
    expect(result.bank.void_king_gloves).toEqual({ itemId: 'void_king_gloves', quantity: 1 })
  })

  it('rewrites legacy "planks" stacks to canonical "plank" in inventory and bank', () => {
    // Regression: the Construction "Build with Plank" recipe and the sawmill
    // once used itemId `planks`, while Trading Post purchases used `plank`,
    // so bought planks were invisible to the build action. Everything now uses
    // canonical `plank`; old saves' `planks` stacks must migrate over.
    const inventory = [{ itemId: 'planks', quantity: 50 }, { itemId: 'oak_plank', quantity: 5 }]
    const bank = {
      planks: { itemId: 'planks', quantity: 200 },
      plank: { itemId: 'plank', quantity: 10 },
    }
    const result = migrateLegacyItemIds({ equipment: {}, inventory, bank })
    expect(result.changed).toBe(true)
    expect(result.inventory[0]).toEqual({ itemId: 'plank', quantity: 50 })
    expect(result.inventory[1]).toEqual({ itemId: 'oak_plank', quantity: 5 })
    expect(result.bank.planks).toBeUndefined()
    // existing `plank` (10) + migrated `planks` (200) merge to a single stack.
    expect(result.bank.plank).toEqual({ itemId: 'plank', quantity: 210 })
  })

  it('handles missing containers safely', () => {
    const result = migrateLegacyItemIds({ equipment: null as any, inventory: null as any, bank: null as any })
    expect(result.changed).toBe(false)
  })
})
