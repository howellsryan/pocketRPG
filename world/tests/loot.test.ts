import { describe, expect, it } from 'vitest'
import {
  KILL_DROP_OWNER_TICKS,
  LOOT_DESPAWN_TICKS,
  LOOT_OWNER_TICKS,
  PLAYER_DROP_OWNER_TICKS,
  isExpired,
  isVisibleTo,
  mayTake,
  spawnDrops,
  takeLoot,
  visibleLootFor,
  type LootEntity,
  type LootViewer,
} from '../server/loot'
import { emptyInventory } from '../server/mining'
import { flushGrants, type GrantIO, type GrantPayload } from '../server/grants'
import { applySlayerCreditToSave } from '../../functions/_lib/game/slayerCredit.js'

describe('spawnDrops', () => {
  it('creates one entity per non-empty drop, owned by the killer at the death tile', () => {
    const loot = spawnDrops([{ itemId: 'bones', quantity: 1 }, { itemId: 'cowhide', quantity: 1 }], 10, 12, '1', 40)
    expect(loot).toHaveLength(2)
    expect(loot[0]).toMatchObject({ itemId: 'bones', qty: 1, x: 10, z: 12, ownerCharId: '1', spawnTick: 40 })
    expect(new Set(loot.map((l) => l.id)).size).toBe(2)
  })
  it('splits a non-stackable drop into one entity per unit so the take menu lists each copy', () => {
    const loot = spawnDrops([{ itemId: 'cowhide', quantity: 3 }], 4, 5, '1', 9)
    expect(loot).toHaveLength(3)
    expect(loot.every((l) => l.itemId === 'cowhide' && l.qty === 1)).toBe(true)
    expect(new Set(loot.map((l) => l.id)).size).toBe(3)
  })
  it('keeps a stackable drop as a single pile carrying its whole quantity', () => {
    const loot = spawnDrops([{ itemId: 'coins', quantity: 12_000 }], 4, 5, '1', 9)
    expect(loot).toHaveLength(1)
    expect(loot[0]).toMatchObject({ itemId: 'coins', qty: 12_000 })
  })
  it('carries the player-drop flag onto every unit of a split stack', () => {
    const loot = spawnDrops([{ itemId: 'cowhide', quantity: 2 }], 0, 0, '1', 0, 17, { fromPlayer: true })
    expect(loot).toHaveLength(2)
    expect(loot.every((l) => l.fromPlayer === true && l.ownerTicks === 17)).toBe(true)
  })
  it('skips zero-quantity rolls', () => {
    expect(spawnDrops([{ itemId: 'bones', quantity: 0 }], 0, 0, '1', 0)).toHaveLength(0)
  })

  it('holds a kill pile long enough to actually pick a full pack up', () => {
    // Pickup is one item per tick and a death can put a 28-slot pack plus worn
    // gear on one tile, each non-stackable unit its own entity. The 17-tick
    // window a voluntarily dropped item gets would go public mid-pickup.
    expect(KILL_DROP_OWNER_TICKS).toBeGreaterThan(28 + 11)
    const pile = spawnDrops([{ itemId: 'shark', quantity: 1 }], 0, 0, 'killer', 0, KILL_DROP_OWNER_TICKS, { fromPlayer: true })[0]
    const bystander = { charId: 'other', isIronman: false }
    expect(isVisibleTo(pile, bystander, PLAYER_DROP_OWNER_TICKS + 1)).toBe(false)
    expect(isVisibleTo(pile, bystander, KILL_DROP_OWNER_TICKS)).toBe(true)
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

  // The last-word guard: even if visibility leaks the entity (stale client
  // view, replayed take, a future change to the windows), the item must not
  // reach the pack.
  it('refuses the take itself, not just the view, for loot an Ironman does not own', () => {
    const theirs = loot({ ownerCharId: '2' })
    expect(mayTake(theirs, iron('1'))).toBe(false)
    expect(mayTake(theirs, main('1'))).toBe(true)
  })
  it('lets an Ironman take their own loot, and never blocks a standard account', () => {
    const mine = loot({ ownerCharId: '1' })
    expect(mayTake(mine, iron('1'))).toBe(true)
    expect(mayTake(mine, main('1'))).toBe(true)
    expect(mayTake(loot({ ownerCharId: '2', ownerTicks: PLAYER_DROP_OWNER_TICKS }), iron('1'))).toBe(false)
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
      applySlayerCreditToSave,
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
