import { describe, expect, it } from 'vitest'
import {
  LOOT_DESPAWN_TICKS,
  LOOT_OWNER_TICKS,
  PLAYER_DROP_OWNER_TICKS,
  isExpired,
  isVisibleTo,
  spawnDrops,
  takeLoot,
  visibleLootFor,
  type LootEntity,
  type LootViewer,
} from '../server/loot'
import { emptyInventory } from '../server/mining'
import { flushGrants, type GrantIO, type GrantPayload } from '../server/grants'

describe('spawnDrops', () => {
  it('creates one entity per non-empty drop, owned by the killer at the death tile', () => {
    const loot = spawnDrops([{ itemId: 'bones', quantity: 1 }, { itemId: 'cowhide', quantity: 2 }], 10, 12, '1', 40)
    expect(loot).toHaveLength(2)
    expect(loot[0]).toMatchObject({ itemId: 'bones', qty: 1, x: 10, z: 12, ownerCharId: '1', spawnTick: 40 })
    expect(new Set(loot.map((l) => l.id)).size).toBe(2)
  })
  it('skips zero-quantity rolls', () => {
    expect(spawnDrops([{ itemId: 'bones', quantity: 0 }], 0, 0, '1', 0)).toHaveLength(0)
  })
})

function loot(overrides: Partial<LootEntity> = {}): LootEntity {
  return { id: 'loot_1', itemId: 'bones', qty: 1, x: 0, z: 0, ownerCharId: '1', spawnTick: 0, ...overrides }
}

function main(charId: string): LootViewer {
  return { charId, isIronman: false }
}
function iron(charId: string): LootViewer {
  return { charId, isIronman: true }
}

describe('visibility windows', () => {
  it('is owner-only inside the owner window, public after', () => {
    const l = loot({ spawnTick: 0 })
    expect(isVisibleTo(l, main('1'), LOOT_OWNER_TICKS - 1)).toBe(true)
    expect(isVisibleTo(l, main('2'), LOOT_OWNER_TICKS - 1)).toBe(false)
    expect(isVisibleTo(l, main('2'), LOOT_OWNER_TICKS)).toBe(true)
  })
  it('is invisible + expired once the despawn window elapses', () => {
    const l = loot({ spawnTick: 0 })
    expect(isExpired(l, LOOT_DESPAWN_TICKS)).toBe(true)
    expect(isVisibleTo(l, main('1'), LOOT_DESPAWN_TICKS)).toBe(false)
  })
  it('visibleLootFor filters to the requesting client', () => {
    const mine = loot({ id: 'a', ownerCharId: '1', spawnTick: 0 })
    const theirs = loot({ id: 'b', ownerCharId: '2', spawnTick: 0 })
    const ids = visibleLootFor([mine, theirs], main('1'), 5).map((l) => l.id)
    expect(ids).toEqual(['a'])
  })
})

describe('Ironman floor loot', () => {
  it('never opens the public window on another player kill drop, at any tick', () => {
    const theirs = loot({ ownerCharId: '2', spawnTick: 0 })
    for (const tick of [0, LOOT_OWNER_TICKS - 1, LOOT_OWNER_TICKS, LOOT_OWNER_TICKS + 1, LOOT_DESPAWN_TICKS - 1]) {
      expect(isVisibleTo(theirs, iron('1'), tick)).toBe(false)
    }
    // A standard account still gets the drop once the window elapses.
    expect(isVisibleTo(theirs, main('1'), LOOT_OWNER_TICKS)).toBe(true)
  })

  it('never opens the faster public window on an item another player dropped', () => {
    const dropped = loot({ ownerCharId: '2', spawnTick: 0, ownerTicks: PLAYER_DROP_OWNER_TICKS })
    expect(isVisibleTo(dropped, iron('1'), PLAYER_DROP_OWNER_TICKS)).toBe(false)
    expect(isVisibleTo(dropped, iron('1'), PLAYER_DROP_OWNER_TICKS + 500)).toBe(false)
    expect(isVisibleTo(dropped, main('1'), PLAYER_DROP_OWNER_TICKS)).toBe(true)
  })

  it('keeps the Ironman own kill loot and own drops, inside and outside the window', () => {
    const mine = loot({ ownerCharId: '1', spawnTick: 0 })
    expect(isVisibleTo(mine, iron('1'), 0)).toBe(true)
    expect(isVisibleTo(mine, iron('1'), LOOT_OWNER_TICKS + 1)).toBe(true)
    expect(isVisibleTo(mine, iron('1'), LOOT_DESPAWN_TICKS)).toBe(false)
  })

  it('shows an Ironman only their own pile when a group shares a boss instance', () => {
    const own = loot({ id: 'a', itemId: 'grondar_godsword', ownerCharId: '1', spawnTick: 0 })
    const killed = loot({ id: 'b', itemId: 'grondar_godsword', ownerCharId: '2', spawnTick: 0 })
    const dropped = loot({ id: 'c', itemId: 'coins', ownerCharId: '3', spawnTick: 0, ownerTicks: PLAYER_DROP_OWNER_TICKS })
    const tick = LOOT_OWNER_TICKS + 10
    expect(visibleLootFor([own, killed, dropped], iron('1'), tick).map((l) => l.id)).toEqual(['a'])
    expect(visibleLootFor([own, killed, dropped], main('1'), tick).map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('takeLoot (inventory-first)', () => {
  it('adds to the pack AND records the units as minted', () => {
    const inv = emptyInventory()
    const minted: Record<string, number> = {}
    expect(takeLoot(inv, minted, 'cowhide', 2)).toBe(true)
    expect(inv.filter((s) => s?.itemId === 'cowhide')).toHaveLength(2)
    expect(minted.cowhide).toBe(2)
  })
  it('leaves inventory and minted untouched when the pack is full', () => {
    const inv = new Array(28).fill(null).map(() => ({ itemId: 'stone', quantity: 1 }))
    const minted: Record<string, number> = {}
    expect(takeLoot(inv, minted, 'cowhide', 1)).toBe(false)
    expect(minted.cowhide).toBeUndefined()
  })
})

// The inventory-first payoff: loot picked up in the world must reach the save's
// INVENTORY on a disconnect flush (not evaporate). Drives the real flushGrants.
describe('picked-up loot survives a disconnect flush', () => {
  function makeIO(save: Record<string, unknown>): GrantIO {
    return {
      loadCharacterWithSave: async () => ({ saveObject: structuredClone(save), saveRevision: 1 }),
      writeSave: async (_e, _c, saveObject) => { Object.assign(save, saveObject) },
      addItemToBank: (s, itemId, qty) => {
        const bank = ((s.bank ??= {}) as Record<string, { itemId: string; quantity: number }>)
        bank[itemId] = { itemId, quantity: (bank[itemId]?.quantity ?? 0) + qty }
      },
      addItemToInventory: (s, itemId, qty) => {
        const inv = ((s.inventory ??= []) as { itemId: string; quantity: number }[])
        for (let i = 0; i < qty; i++) inv.push({ itemId, quantity: 1 })
      },
      removeItemFromInventory: () => {},
      removeItemFromBank: () => {},
      bankQuantity: () => 0,
      auditLog: async () => {},
    }
  }

  it('lands minted loot in save.inventory on disconnect', async () => {
    const inv = emptyInventory()
    const minted: Record<string, number> = {}
    takeLoot(inv, minted, 'cowhide', 1)
    takeLoot(inv, minted, 'bones', 1)

    const save: Record<string, unknown> = { stats: {}, inventory: [], bank: {} }
    // .first() → null so flushGrants' isCharacterInActiveMatch check reads "no
    // active match" (no PvP rows seeded in this pure grant test).
    const db = { prepare: () => ({ bind: () => ({ run: async () => ({ meta: { changes: 1 } }), first: async () => null }) }) }
    const payload: GrantPayload = {
      xpBySkill: {}, items: Object.entries(minted).map(([itemId, quantity]) => ({ itemId, quantity })),
      itemsTo: 'inventory', moveToBank: [], reason: 'disconnect',
    }
    const ok = await flushGrants({ DB: db as unknown as D1Database }, { charId: 1, identityId: '1', sessionId: 's', flushSeq: 1 }, payload, makeIO(save))
    expect(ok).toBe(true)
    const savedInv = save.inventory as { itemId: string }[]
    expect(savedInv.map((s) => s.itemId).sort()).toEqual(['bones', 'cowhide'])
  })
})
