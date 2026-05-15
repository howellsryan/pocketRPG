import { describe, it, expect, beforeEach } from 'vitest'
import {
  executeBuyMatching,
  executeSellMatching,
  insertOffer,
  cancelOffer,
  instantSellOffer,
  getOwnedOffer,
  sweepPendingDeliveries,
  isOrderBookItem,
  isTradingPostListable,
  assertSlotAvailable,
  escrowSellItems,
  escrowBuyCoins,
  MAX_ACTIVE_OFFERS_PER_CHARACTER,
  INSTANT_SELL_PAYOUT_FRACTION,
} from '../functions/_lib/game/tradingPost.js'

// Tiny in-memory shim of the subset of D1 that tradingPost.js actually uses.
// Supports the exact SQL strings used by the engine via pattern matching.
type Row = Record<string, any>

class FakeDB {
  rows: Row[] = []
  nextId = 1

  private match(stmt: string) {
    const sql = stmt.trim().replace(/\s+/g, ' ')
    return sql
  }

  prepare(stmt: string) {
    const sql = this.match(stmt)
    const db = this
    return {
      params: [] as any[],
      bind(...args: any[]) { this.params = args; return this },
      async run() {
        return db._run(sql, this.params)
      },
      async first() {
        const { results } = await db._all(sql, this.params)
        return results[0] || null
      },
      async all() {
        return db._all(sql, this.params)
      },
    }
  }

  private async _run(sql: string, params: any[]) {
    if (sql.startsWith('INSERT INTO trading_post_offers')) {
      const id = this.nextId++
      const [characterId, offerType, itemId, price, qTotal, qRem, status, createdAt, updatedAt] = params
      this.rows.push({
        id,
        character_id: characterId,
        offer_type: offerType,
        item_id: itemId,
        price,
        quantity_total: qTotal,
        quantity_remaining: qRem,
        coins_pending: 0,
        items_pending: 0,
        status,
        created_at: createdAt,
        updated_at: updatedAt,
      })
      return { meta: { last_row_id: id, changes: 1 } }
    }
    if (sql.startsWith('UPDATE trading_post_offers SET quantity_remaining = ?, status = ?, updated_at = ? WHERE id = ?')) {
      const [qRem, status, updatedAt, id] = params
      const row = this.rows.find((r) => r.id === id)
      if (row) { row.quantity_remaining = qRem; row.status = status; row.updated_at = updatedAt }
      return { meta: { changes: row ? 1 : 0 } }
    }
    if (sql.startsWith('UPDATE trading_post_offers SET coins_pending = coins_pending + ?, updated_at = ?')) {
      const [delta, updatedAt, id] = params
      const row = this.rows.find((r) => r.id === id)
      if (row) { row.coins_pending = (row.coins_pending || 0) + delta; row.updated_at = updatedAt }
      return { meta: { changes: row ? 1 : 0 } }
    }
    if (sql.startsWith('UPDATE trading_post_offers SET items_pending = items_pending + ?, updated_at = ?')) {
      const [delta, updatedAt, id] = params
      const row = this.rows.find((r) => r.id === id)
      if (row) { row.items_pending = (row.items_pending || 0) + delta; row.updated_at = updatedAt }
      return { meta: { changes: row ? 1 : 0 } }
    }
    if (sql.startsWith('UPDATE trading_post_offers SET coins_pending = 0, items_pending = 0')) {
      const [updatedAt, id] = params
      const row = this.rows.find((r) => r.id === id)
      if (row) { row.coins_pending = 0; row.items_pending = 0; row.updated_at = updatedAt }
      return { meta: { changes: row ? 1 : 0 } }
    }
    if (sql.startsWith('UPDATE trading_post_offers SET status = \'cancelled\'')) {
      const [updatedAt, id] = params
      const row = this.rows.find((r) => r.id === id)
      if (row) { row.status = 'cancelled'; row.quantity_remaining = 0; row.coins_pending = 0; row.items_pending = 0; row.updated_at = updatedAt }
      return { meta: { changes: row ? 1 : 0 } }
    }
    if (sql.startsWith('UPDATE trading_post_offers SET character_id = NULL')) {
      const [updatedAt, id] = params
      const row = this.rows.find((r) => r.id === id)
      if (row) { row.character_id = null; row.coins_pending = 0; row.items_pending = 0; row.updated_at = updatedAt }
      return { meta: { changes: row ? 1 : 0 } }
    }
    throw new Error('Unhandled SQL (run): ' + sql)
  }

  private async _all(sql: string, params: any[]) {
    if (sql.startsWith('SELECT COUNT(*) AS n FROM trading_post_offers WHERE character_id = ? AND status = \'active\'')) {
      const [characterId] = params
      const n = this.rows.filter((r) => r.character_id === characterId && r.status === 'active').length
      return { results: [{ n }] }
    }
    if (sql.startsWith('SELECT * FROM trading_post_offers WHERE item_id = ? AND offer_type = \'sell\' AND status = \'active\' AND price <= ?')) {
      const [itemId, maxPrice] = params
      const results = this.rows
        .filter((r) => r.item_id === itemId && r.offer_type === 'sell' && r.status === 'active' && r.price <= maxPrice)
        .sort((a, b) => a.price - b.price || a.created_at - b.created_at)
      return { results }
    }
    if (sql.startsWith('SELECT * FROM trading_post_offers WHERE item_id = ? AND offer_type = \'buy\' AND status = \'active\' AND price >= ?')) {
      const [itemId, minPrice] = params
      const results = this.rows
        .filter((r) => r.item_id === itemId && r.offer_type === 'buy' && r.status === 'active' && r.price >= minPrice)
        .sort((a, b) => b.price - a.price || a.created_at - b.created_at)
      return { results }
    }
    if (sql.startsWith('SELECT * FROM trading_post_offers WHERE id = ? AND character_id = ?')) {
      const [id, characterId] = params
      const results = this.rows.filter((r) => r.id === id && r.character_id === characterId)
      return { results }
    }
    if (sql.startsWith('SELECT * FROM trading_post_offers WHERE character_id = ? AND status IN')) {
      const [characterId] = params
      const results = this.rows
        .filter((r) => r.character_id === characterId && (r.status === 'active' || r.status === 'completed'))
        .sort((a, b) => b.created_at - a.created_at)
      return { results }
    }
    throw new Error('Unhandled SQL (all): ' + sql)
  }
}

function fakeEnv() {
  return { DB: new FakeDB() } as any
}

function makeSave(coins = 0, inventory: any[] = []) {
  return { coins, inventory, bank: {} } as any
}

const ITEM = { warped_bow: { isBossUnique: true, stackable: false }, ring_of_endless_riches: { isClueReward: true, stackable: false }, coins: { stackable: true } }

describe('trading post classification', () => {
  it('flags boss/raid/clue items as order book', () => {
    expect(isOrderBookItem({ isBossUnique: true })).toBe(true)
    expect(isOrderBookItem({ isClueReward: true })).toBe(true)
    expect(isOrderBookItem({ isRaidUnique: true })).toBe(true)
    expect(isOrderBookItem({ shopValue: 100 })).toBe(false)
  })

  it('blocks untradeables from being listable', () => {
    expect(isTradingPostListable({ isBossUnique: true })).toBe(true)
    expect(isTradingPostListable({ isBossUnique: true, isUntradeable: true })).toBe(false)
    expect(isTradingPostListable({ shopValue: 50 })).toBe(true)
    expect(isTradingPostListable({ shopValue: 50, isUntradeable: true })).toBe(false)
    expect(isTradingPostListable({ shopValue: 0 })).toBe(false)
    expect(isTradingPostListable({})).toBe(false)
  })
})

describe('order matching — buy side', () => {
  let env: any
  beforeEach(() => { env = fakeEnv() })

  it('fills a buy at the seller\'s cheaper price (user spec example: cap 100, sell exists at 50)', async () => {
    // Seller B listed 1 warped_bow at 50.
    await insertOffer(env, { characterId: 2, offerType: 'sell', itemId: 'warped_bow', price: 50, quantityTotal: 1, quantityRemaining: 1 })
    const buyerSave = makeSave(0)
    // Buyer A bids 100 cap. Engine should match at seller's price (50).
    const res = await executeBuyMatching(env, {
      buyerCharacterId: 1, buyerSave, itemId: 'warped_bow', maxPrice: 100, quantity: 1, stackable: false,
    })
    expect(res.remaining).toBe(0)
    expect(res.totalReceived).toBe(1)
    expect(res.totalSpent).toBe(50)
    // Seller B is offline -- coins go to their offer row as coins_pending.
    const sellerOffer = env.DB.rows[0]
    expect(sellerOffer.status).toBe('completed')
    expect(sellerOffer.coins_pending).toBe(50)
    // Buyer's inventory got the item.
    expect(buyerSave.inventory.find((s: any) => s.itemId === 'warped_bow')?.quantity).toBe(1)
  })

  it('walks the book from cheapest to most expensive across multiple sells', async () => {
    await insertOffer(env, { characterId: 2, offerType: 'sell', itemId: 'warped_bow', price: 100, quantityTotal: 5, quantityRemaining: 5 })
    await insertOffer(env, { characterId: 3, offerType: 'sell', itemId: 'warped_bow', price: 50, quantityTotal: 3, quantityRemaining: 3 })
    const buyerSave = makeSave(0)
    const res = await executeBuyMatching(env, {
      buyerCharacterId: 1, buyerSave, itemId: 'warped_bow', maxPrice: 200, quantity: 5, stackable: false,
    })
    // 3 from cheap seller @50 + 2 from expensive @100 = 150 + 200 = 350.
    expect(res.totalReceived).toBe(5)
    expect(res.totalSpent).toBe(350)
    expect(res.matches).toHaveLength(2)
    expect(res.matches[0]).toMatchObject({ price: 50, quantity: 3 })
    expect(res.matches[1]).toMatchObject({ price: 100, quantity: 2 })
  })

  it('refuses to match sells above the buyer\'s cap (partial buy ok)', async () => {
    await insertOffer(env, { characterId: 2, offerType: 'sell', itemId: 'warped_bow', price: 200, quantityTotal: 5, quantityRemaining: 5 })
    const buyerSave = makeSave(0)
    const res = await executeBuyMatching(env, {
      buyerCharacterId: 1, buyerSave, itemId: 'warped_bow', maxPrice: 100, quantity: 5, stackable: false,
    })
    expect(res.totalReceived).toBe(0)
    expect(res.remaining).toBe(5)
  })

  it('partially fills a seller without completing them', async () => {
    // User spec: list 100, buyer takes 99 -> seller has 1 left.
    await insertOffer(env, { characterId: 2, offerType: 'sell', itemId: 'warped_bow', price: 50, quantityTotal: 100, quantityRemaining: 100 })
    const buyerSave = makeSave(0)
    const res = await executeBuyMatching(env, {
      buyerCharacterId: 1, buyerSave, itemId: 'warped_bow', maxPrice: 50, quantity: 99, stackable: false,
    })
    expect(res.totalReceived).toBe(99)
    const sellerOffer = env.DB.rows[0]
    expect(sellerOffer.quantity_remaining).toBe(1)
    expect(sellerOffer.status).toBe('active')
    expect(sellerOffer.coins_pending).toBe(99 * 50)
  })
})

describe('order matching — sell side', () => {
  let env: any
  beforeEach(() => { env = fakeEnv() })

  it('fills a sell at the buyer\'s higher price (user spec example: list 100, buy offer at 200)', async () => {
    await insertOffer(env, { characterId: 2, offerType: 'buy', itemId: 'warped_bow', price: 200, quantityTotal: 1, quantityRemaining: 1 })
    const sellerSave = makeSave(0)
    const res = await executeSellMatching(env, {
      sellerCharacterId: 1, sellerSave, itemId: 'warped_bow', minPrice: 100, quantity: 1, stackable: false,
    })
    expect(res.totalEarned).toBe(200)
    expect(sellerSave.coins).toBe(200)
    const buyerOffer = env.DB.rows[0]
    expect(buyerOffer.status).toBe('completed')
    expect(buyerOffer.items_pending).toBe(1)
  })

  it('walks buy offers from highest price first', async () => {
    await insertOffer(env, { characterId: 2, offerType: 'buy', itemId: 'warped_bow', price: 100, quantityTotal: 3, quantityRemaining: 3 })
    await insertOffer(env, { characterId: 3, offerType: 'buy', itemId: 'warped_bow', price: 200, quantityTotal: 2, quantityRemaining: 2 })
    const sellerSave = makeSave(0)
    const res = await executeSellMatching(env, {
      sellerCharacterId: 1, sellerSave, itemId: 'warped_bow', minPrice: 50, quantity: 5, stackable: false,
    })
    expect(res.totalSold).toBe(5)
    expect(res.totalEarned).toBe(2 * 200 + 3 * 100)
    expect(res.matches[0].price).toBe(200)
    expect(res.matches[1].price).toBe(100)
  })

  it('refuses to fill below the seller\'s floor', async () => {
    await insertOffer(env, { characterId: 2, offerType: 'buy', itemId: 'warped_bow', price: 50, quantityTotal: 5, quantityRemaining: 5 })
    const sellerSave = makeSave(0)
    const res = await executeSellMatching(env, {
      sellerCharacterId: 1, sellerSave, itemId: 'warped_bow', minPrice: 100, quantity: 5, stackable: false,
    })
    expect(res.totalSold).toBe(0)
  })
})

describe('orphan stock (instant sell)', () => {
  let env: any
  beforeEach(() => { env = fakeEnv() })

  it('pays seller 80% of remaining and detaches character_id', async () => {
    const offerId = await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'warped_bow', price: 1000, quantityTotal: 5, quantityRemaining: 5 })
    const offer = await getOwnedOffer(env, offerId!, 1)
    const sellerSave = makeSave(0)
    const payout = await instantSellOffer(env, { offer, saveObject: sellerSave, itemsLookup: ITEM })
    expect(payout).toBe(Math.floor(5 * 1000 * INSTANT_SELL_PAYOUT_FRACTION))
    expect(sellerSave.coins).toBe(payout)
    const row = env.DB.rows[0]
    expect(row.character_id).toBeNull()
    expect(row.price).toBe(1000) // listed price preserved
    expect(row.quantity_remaining).toBe(5)
  })

  it('orphan stock is matched by future buyers at the original price (gold sink)', async () => {
    // Set up an orphan @1000.
    const offerId = await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'warped_bow', price: 1000, quantityTotal: 2, quantityRemaining: 2 })
    const offer = await getOwnedOffer(env, offerId!, 1)
    const sellerSave = makeSave(0)
    await instantSellOffer(env, { offer, saveObject: sellerSave, itemsLookup: ITEM })
    // Buyer comes in, cap 5000.
    const buyerSave = makeSave(0)
    const res = await executeBuyMatching(env, {
      buyerCharacterId: 9, buyerSave, itemId: 'warped_bow', maxPrice: 5000, quantity: 2, stackable: false,
    })
    expect(res.totalReceived).toBe(2)
    expect(res.totalSpent).toBe(2000)
    // Coins go to void -- the orphan row had character_id null so no
    // coins_pending should accumulate.
    const orphan = env.DB.rows[0]
    expect(orphan.coins_pending).toBe(0)
    expect(orphan.status).toBe('completed')
  })
})

describe('cancellation refunds escrow', () => {
  let env: any
  beforeEach(() => { env = fakeEnv() })

  it('returns remaining items on sell cancel', async () => {
    const offerId = await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'warped_bow', price: 1000, quantityTotal: 5, quantityRemaining: 3 })
    const offer = await getOwnedOffer(env, offerId!, 1)
    const save = makeSave(0)
    await cancelOffer(env, { offer, saveObject: save, itemsLookup: ITEM })
    // Non-stackable, qty 3 -> delivered as noted stack.
    expect(save.inventory.find((s: any) => s.itemId === 'warped_bow')?.quantity).toBe(3)
    const row = env.DB.rows[0]
    expect(row.status).toBe('cancelled')
  })

  it('refunds unspent coins on buy cancel', async () => {
    const offerId = await insertOffer(env, { characterId: 1, offerType: 'buy', itemId: 'warped_bow', price: 1000, quantityTotal: 5, quantityRemaining: 2 })
    const offer = await getOwnedOffer(env, offerId!, 1)
    const save = makeSave(0)
    await cancelOffer(env, { offer, saveObject: save, itemsLookup: ITEM })
    expect(save.coins).toBe(2 * 1000)
    expect(env.DB.rows[0].status).toBe('cancelled')
  })
})

describe('slot limits and sweeping', () => {
  let env: any
  beforeEach(() => { env = fakeEnv() })

  it('blocks more than MAX active offers per character', async () => {
    for (let i = 0; i < MAX_ACTIVE_OFFERS_PER_CHARACTER; i++) {
      await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'warped_bow', price: 10 + i, quantityTotal: 1, quantityRemaining: 1 })
    }
    await expect(assertSlotAvailable(env, 1)).rejects.toThrow(/active offers/i)
  })

  it('sweepPendingDeliveries clears coins_pending and items_pending into save', async () => {
    const id = await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'warped_bow', price: 100, quantityTotal: 5, quantityRemaining: 3 })
    // Simulate a counterparty match queued some pending coins.
    env.DB.rows[0].coins_pending = 200
    const save = makeSave(50)
    const swept = await sweepPendingDeliveries(env, 1, save, ITEM)
    expect(swept).toBe(true)
    expect(save.coins).toBe(250)
    expect(env.DB.rows[0].coins_pending).toBe(0)
  })
})

describe('escrow primitives', () => {
  it('escrowSellItems removes from inventory', () => {
    const save = makeSave(0, [{ itemId: 'warped_bow', quantity: 5 }])
    escrowSellItems(save, 'warped_bow', 3)
    expect(save.inventory[0].quantity).toBe(2)
  })

  it('escrowBuyCoins subtracts from coins (inventory + bank)', () => {
    const save = makeSave(1000)
    escrowBuyCoins(save, 800)
    expect(save.coins).toBe(200)
  })
})
