import { describe, it, expect } from 'vitest'
import { settleActionCompletion } from '../functions/_lib/game/actionCompletion.js'

function makeSave() {
  return {
    inventory: [],
    bank: [],
    settings: {},
    _serverActionNonces: {},
  } as any
}

describe('action completion authority helpers', () => {
  it('accepts regular monster drops that are not collection-log entries', () => {
    const save = makeSave()
    const out = settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: 'field_chicken',
      nonce: 'monster:field_chicken:1',
      rewards: [{ itemId: 'raw_chicken', quantity: 1 }],
    })

    expect(out.granted).toEqual([{ itemId: 'raw_chicken', quantity: 1, destination: 'inventory' }])
  })

  it('accepts boss source type using monster drop validation', () => {
    const save = makeSave()
    const out = settleActionCompletion(save, {
      sourceType: 'boss',
      sourceId: 'king_black_dragon',
      nonce: 'boss:kbd:1',
      rewards: [{ itemId: 'dragon_bones', quantity: 1 }],
    })

    expect(out.granted).toEqual([{ itemId: 'dragon_bones', quantity: 1, destination: 'inventory' }])
  })

  it('still rejects items not valid for the provided monster source', () => {
    const save = makeSave()
    expect(() => settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: 'field_chicken',
      nonce: 'monster:field_chicken:2',
      rewards: [{ itemId: 'nether_demon_whip', quantity: 1 }],
    })).toThrow(/Reward item not valid for source/)
  })

  it('routes non-stackable rewards to bank when inventory fills during completion', () => {
    const save = makeSave()
    save.inventory = Array.from({ length: 27 }, (_, i) => ({ itemId: `filler_${i}`, quantity: 1 }))
    const out = settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: 'field_chicken',
      nonce: 'monster:field_chicken:3',
      rewards: [{ itemId: 'raw_chicken', quantity: 2 }],
    })

    expect(out.granted).toEqual([
      { itemId: 'raw_chicken', quantity: 1, destination: 'inventory' },
      { itemId: 'raw_chicken', quantity: 1, destination: 'bank' },
    ])
  })

  it('keeps stackable rewards in inventory when stack already exists even if full', () => {
    const save = makeSave()
    save.inventory = [
      { itemId: 'feather', quantity: 10 },
      ...Array.from({ length: 27 }, (_, i) => ({ itemId: `filler_${i}`, quantity: 1 })),
    ]
    const out = settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: 'field_chicken',
      nonce: 'monster:field_chicken:4',
      rewards: [{ itemId: 'feather', quantity: 50 }],
    })

    expect(out.granted).toEqual([{ itemId: 'feather', quantity: 50, destination: 'inventory' }])
  })

  it('persists boss uniques rolled after stackable drops (coins-then-unique tables)', () => {
    // Regression for "only boss uniques get lost on MCP": getInventory() rebuilds
    // save.inventory into a fresh array on every call, and addItemToInventory()
    // calls it internally. A reference captured once before the reward loop went
    // stale after the first stackable was added to the inventory, so the
    // non-stackable uniques that follow in a boss's drop table (e.g. Warlord
    // Grondar lists coins/runes before its unique armour) were pushed onto the
    // detached array and silently dropped from the persisted save. Stackable
    // loot was unaffected, matching the observed symptom.
    const save = makeSave()
    save.inventory = [{ itemId: 'coins', quantity: 100 }]
    const out = settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: 'warlord_grondar',
      nonce: 'monster:grondar:5',
      rewards: [
        { itemId: 'coins', quantity: 20000 },         // stackable — coalesces, reassigns the inv array
        { itemId: 'grondar_chestplate', quantity: 1 }, // unique listed after coins in the drop table
        { itemId: 'grondar_hilt', quantity: 1 },
      ],
    })

    expect(out.granted).toEqual([
      { itemId: 'coins', quantity: 20000, destination: 'inventory' },
      { itemId: 'grondar_chestplate', quantity: 1, destination: 'inventory' },
      { itemId: 'grondar_hilt', quantity: 1, destination: 'inventory' },
    ])
    // The uniques must actually be in the persisted inventory, not just reported.
    const ids = save.inventory.map((s: any) => s?.itemId)
    expect(ids).toContain('grondar_chestplate')
    expect(ids).toContain('grondar_hilt')
    expect(save.inventory.find((s: any) => s?.itemId === 'coins')?.quantity).toBe(20100)
  })

  it('banks a boss unique rolled after a stackable when the inventory is full', () => {
    // "Drops lost after the inventory becomes full": a coins drop coalesces onto
    // an existing stack (reassigning the inv array), then the unique that follows
    // must still spill to the bank rather than vanish.
    const save = makeSave()
    save.inventory = [
      { itemId: 'coins', quantity: 100 },
      ...Array.from({ length: 27 }, (_, i) => ({ itemId: `filler_${i}`, quantity: 1 })),
    ]
    const out = settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: 'warlord_grondar',
      nonce: 'monster:grondar:6',
      rewards: [
        { itemId: 'coins', quantity: 20000 },
        { itemId: 'grondar_chestplate', quantity: 1 },
      ],
    })

    expect(out.granted).toEqual([
      { itemId: 'coins', quantity: 20000, destination: 'inventory' },
      { itemId: 'grondar_chestplate', quantity: 1, destination: 'bank' },
    ])
    expect(save.bank.grondar_chestplate?.quantity).toBe(1)
  })

  it('consumes a bank-held clue scroll (inventory-first, then bank)', () => {
    // Regression for "clue claim failed: insufficient supplies": scrolls are
    // auto-banked on drop and the client gates on inventory+bank, but the
    // consumption step only debited the inventory — a bank-held scroll made
    // the server reject a legitimate solve.
    const save = makeSave()
    save.bank = { clue_scroll_medium: { itemId: 'clue_scroll_medium', quantity: 2 } }
    settleActionCompletion(save, {
      sourceType: 'clues',
      sourceId: 'medium',
      nonce: 'clue:medium:1',
      rewards: [],
      consumptions: [{ itemId: 'clue_scroll_medium', quantity: 1 }],
    })
    expect(save.bank.clue_scroll_medium.quantity).toBe(1)
  })

  it('splits a consumption across inventory and bank, inventory first', () => {
    const save = makeSave()
    save.inventory = [{ itemId: 'clue_scroll_medium', quantity: 1 }]
    save.bank = { clue_scroll_medium: { itemId: 'clue_scroll_medium', quantity: 1 } }
    settleActionCompletion(save, {
      sourceType: 'clues',
      sourceId: 'medium',
      nonce: 'clue:medium:2',
      rewards: [],
      consumptions: [{ itemId: 'clue_scroll_medium', quantity: 2 }],
    })
    expect(save.inventory.filter((s: any) => s?.itemId === 'clue_scroll_medium')).toEqual([])
    expect(save.bank.clue_scroll_medium).toBeUndefined()
  })

  it('still rejects a consumption that inventory and bank together cannot cover', () => {
    const save = makeSave()
    save.bank = { clue_scroll_medium: { itemId: 'clue_scroll_medium', quantity: 1 } }
    expect(() => settleActionCompletion(save, {
      sourceType: 'clues',
      sourceId: 'medium',
      nonce: 'clue:medium:3',
      rewards: [],
      consumptions: [{ itemId: 'clue_scroll_medium', quantity: 2 }],
    })).toThrow(/Insufficient supplies/)
    // and nothing was debited by the failed attempt
    expect(save.bank.clue_scroll_medium.quantity).toBe(1)
  })

  it('spends slayer points from settings.slayerPoints (the canonical save location)', () => {
    // Regression: a slayer unlock purchase (e.g. slayer_helmet, cost 400)
    // round-trips through this handler with slayerPoints: -cost. The points
    // live at settings.slayerPoints, so reading them anywhere else makes the
    // server see 0 and reject the spend with INSUFFICIENT_SUPPLIES.
    const save = makeSave()
    save.settings.slayerPoints = 500
    const out = settleActionCompletion(save, {
      sourceType: 'slayer',
      sourceId: 'slayer',
      nonce: 'slayer:slayer_helmet:1',
      rewards: [{ itemId: 'slayer_helmet', quantity: 1 }],
      slayerPoints: -400,
    })

    expect(out.slayerPoints).toBe(-400)
    expect(save.settings.slayerPoints).toBe(100)
    expect(out.granted).toEqual([{ itemId: 'slayer_helmet', quantity: 1, destination: 'inventory' }])
  })

  it('records a slayer-points purchase in settings.slayerStoreUnlocks so it can later be bought for coins', () => {
    const save = makeSave()
    save.settings.slayerPoints = 500
    settleActionCompletion(save, {
      sourceType: 'slayer',
      sourceId: 'slayer',
      nonce: 'slayer:slayer_helmet:1',
      rewards: [{ itemId: 'slayer_helmet', quantity: 1 }],
      slayerPoints: -400,
    })
    expect(save.settings.slayerStoreUnlocks).toEqual(['slayer_helmet'])

    // Idempotent: a second purchase of the same gear doesn't duplicate the id.
    save.settings.slayerPoints = 500
    settleActionCompletion(save, {
      sourceType: 'slayer',
      sourceId: 'slayer',
      nonce: 'slayer:slayer_helmet:2',
      rewards: [{ itemId: 'slayer_helmet', quantity: 1 }],
      slayerPoints: -400,
    })
    expect(save.settings.slayerStoreUnlocks).toEqual(['slayer_helmet'])
  })

  it('does not record slayerStoreUnlocks for non-slayer completions', () => {
    const save = makeSave()
    settleActionCompletion(save, {
      sourceType: 'monsters',
      sourceId: 'goblin',
      nonce: 'monsters:goblin:1',
      rewards: [],
    })
    expect(save.settings.slayerStoreUnlocks).toBeUndefined()
  })

  it('rejects a slayer-points spend the player cannot afford', () => {
    const save = makeSave()
    save.settings.slayerPoints = 100
    expect(() => settleActionCompletion(save, {
      sourceType: 'slayer',
      sourceId: 'slayer',
      nonce: 'slayer:slayer_defender:1',
      rewards: [{ itemId: 'slayer_defender', quantity: 1 }],
      slayerPoints: -1500,
    })).toThrow(/Insufficient supplies/)
    // The save must be left untouched when the spend is refused.
    expect(save.settings.slayerPoints).toBe(100)
  })

  it("rejects Zul-Kaar's Blade when the server's own slayerMasterTaskCompletions.zul_kaar is below 25, even with ample slayer points", () => {
    // Server-authoritative gate: the client computes/gates on
    // slayerMasterTaskCompletions too, but per §14 that's never sufficient on
    // its own for a high-value grant. This must read strictly from the
    // server's persisted saveObject, never a client-supplied request field.
    const save = makeSave()
    save.settings.slayerPoints = 100_000
    save.settings.slayerMasterTaskCompletions = { zul_kaar: 24 }
    expect(() => settleActionCompletion(save, {
      sourceType: 'slayer',
      sourceId: 'slayer',
      nonce: 'slayer:zul_kaars_blade:1',
      rewards: [{ itemId: 'zul_kaars_blade', quantity: 1 }],
      slayerPoints: -2500,
    })).toThrow(/25 completed Zul-Kaar tasks/)
    // Nothing was granted or debited by the refused attempt.
    expect(save.settings.slayerPoints).toBe(100_000)
    expect(save.inventory).toEqual([])
  })

  it('rejects Zul-Kaar\'s Blade when slayerMasterTaskCompletions.zul_kaar is entirely absent from the save', () => {
    const save = makeSave()
    save.settings.slayerPoints = 100_000
    expect(() => settleActionCompletion(save, {
      sourceType: 'slayer',
      sourceId: 'slayer',
      nonce: 'slayer:zul_kaars_blade:2',
      rewards: [{ itemId: 'zul_kaars_blade', quantity: 1 }],
      slayerPoints: -2500,
    })).toThrow(/25 completed Zul-Kaar tasks/)
  })

  it("grants Zul-Kaar's Blade once the server's slayerMasterTaskCompletions.zul_kaar reaches 25", () => {
    const save = makeSave()
    save.settings.slayerPoints = 2500
    save.settings.slayerMasterTaskCompletions = { zul_kaar: 25 }
    const out = settleActionCompletion(save, {
      sourceType: 'slayer',
      sourceId: 'slayer',
      nonce: 'slayer:zul_kaars_blade:3',
      rewards: [{ itemId: 'zul_kaars_blade', quantity: 1 }],
      slayerPoints: -2500,
    })
    expect(out.granted).toEqual([{ itemId: 'zul_kaars_blade', quantity: 1, destination: 'inventory' }])
    expect(save.settings.slayerPoints).toBe(0)
  })
})
