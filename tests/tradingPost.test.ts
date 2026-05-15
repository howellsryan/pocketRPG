import { describe, it, expect, beforeEach } from 'vitest'
import {
  executeMatching,
  insertOffer,
  cancelOffer,
  collectOffer,
  instantSellOffer,
  getOwnedOffer,
  listOffersForCharacter,
  isOrderBookItem,
  isTradingPostListable,
  assertSlotAvailable,
  escrowSellItems,
  escrowBuyCoins,
  MAX_ACTIVE_OFFERS_PER_CHARACTER,
  INSTANT_SELL_PAYOUT_FRACTION,
  OFFER_STATUS,
} from '../functions/_lib/game/tradingPost.js'
import { getCoinTotal } from '../functions/_lib/game/economy.js'

// Tiny in-memory shim of the subset of D1 that tradingPost.js actually uses.
// Pattern-matches against the exact SQL strings used by the engine.
type Row = Record<string, any>

class FakeDB {
  rows: Row[] = []
  nextId = 1

  prepare(stmt: string) {
    const sql = stmt.trim().replace(/\s+/g, ' ')
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
    if (sql.startsWith('UPDATE trading_post_offers SET coins_pending = coins_pending + ?, quantity_remaining = ?, updated_at = ?')) {
      const [delta, qRem, updatedAt, id] = params
      const row = this.rows.find((r) => r.id === id)
      if (row) {
        row.coins_pending = (row.coins_pending || 0) + delta
        row.quantity_remaining = qRem
        row.updated_at = updatedAt
      }
      return { meta: { changes: row ? 1 : 0 } }
    }
    if (sql.startsWith('UPDATE trading_post_offers SET items_pending = items_pending + ?, quantity_remaining = ?, updated_at = ?')) {
      const [delta, qRem, updatedAt, id] = params
      const row = this.rows.find((r) => r.id === id)
      if (row) {
        row.items_pending = (row.items_pending || 0) + delta
        row.quantity_remaining = qRem
        row.updated_at = updatedAt
      }
      return { meta: { changes: row ? 1 : 0 } }
    }
    if (sql.startsWith('UPDATE trading_post_offers SET quantity_remaining = ?, updated_at = ?')) {
      // Orphan-side decrement (no coins credited, no character to pay).
      const [qRem, updatedAt, id] = params
      const row = this.rows.find((r) => r.id === id)
      if (row) { row.quantity_remaining = qRem; row.updated_at = updatedAt }
      return { meta: { changes: row ? 1 : 0 } }
    }
    if (sql.startsWith('UPDATE trading_post_offers SET status = ?, updated_at = ?')) {
      const [status, updatedAt, id] = params
      const row = this.rows.find((r) => r.id === id)
      if (row) { row.status = status; row.updated_at = updatedAt }
      return { meta: { changes: row ? 1 : 0 } }
    }
    if (sql.startsWith('UPDATE trading_post_offers SET coins_pending = 0, items_pending = 0, updated_at = ?')) {
      const [updatedAt, id] = params
      const row = this.rows.find((r) => r.id === id)
      if (row) { row.coins_pending = 0; row.items_pending = 0; row.updated_at = updatedAt }
      return { meta: { changes: row ? 1 : 0 } }
    }
    if (sql.startsWith('UPDATE trading_post_offers SET character_id = NULL')) {
      const [updatedAt, id] = params
      const row = this.rows.find((r) => r.id === id)
      if (row) { row.character_id = null; row.coins_pending = 0; row.items_pending = 0; row.updated_at = updatedAt }
      return { meta: { changes: row ? 1 : 0 } }
    }
    if (sql.startsWith('DELETE FROM trading_post_offers WHERE id = ?')) {
      const [id] = params
      const idx = this.rows.findIndex((r) => r.id === id)
      if (idx >= 0) this.rows.splice(idx, 1)
      return { meta: { changes: idx >= 0 ? 1 : 0 } }
    }
    throw new Error('Unhandled SQL (run): ' + sql)
  }

  private async _all(sql: string, params: any[]) {
    if (sql.startsWith("SELECT COUNT(*) AS n FROM trading_post_offers WHERE character_id = ? AND status = 'active'")) {
      const [characterId] = params
      const n = this.rows.filter((r) => r.character_id === characterId && r.status === 'active').length
      return { results: [{ n }] }
    }
    const sellMatch = sql.match(/^SELECT \* FROM trading_post_offers WHERE item_id IN \((\?(?:,\?)*)\) AND offer_type = 'sell' AND status = 'active' AND price <= \?/)
    if (sellMatch) {
      const idCount = sellMatch[1].split(',').length
      const itemIds = params.slice(0, idCount)
      const maxPrice = params[idCount]
      const results = this.rows
        .filter((r) => itemIds.includes(r.item_id) && r.offer_type === 'sell' && r.status === 'active' && r.price <= maxPrice)
        .sort((a, b) => a.price - b.price || a.created_at - b.created_at)
      return { results }
    }
    const buyMatch = sql.match(/^SELECT \* FROM trading_post_offers WHERE item_id IN \((\?(?:,\?)*)\) AND offer_type = 'buy' AND status = 'active' AND price >= \?/)
    if (buyMatch) {
      const idCount = buyMatch[1].split(',').length
      const itemIds = params.slice(0, idCount)
      const minPrice = params[idCount]
      const results = this.rows
        .filter((r) => itemIds.includes(r.item_id) && r.offer_type === 'buy' && r.status === 'active' && r.price >= minPrice)
        .sort((a, b) => b.price - a.price || a.created_at - b.created_at)
      return { results }
    }
    if (sql.startsWith('SELECT * FROM trading_post_offers WHERE id = ? AND character_id = ?')) {
      const [id, characterId] = params
      const results = this.rows.filter((r) => r.id === id && r.character_id === characterId)
      return { results }
    }
    if (sql.startsWith('SELECT quantity_remaining, coins_pending, items_pending FROM trading_post_offers WHERE id = ?')) {
      const [id] = params
      const row = this.rows.find((r) => r.id === id)
      return { results: row ? [{ quantity_remaining: row.quantity_remaining, coins_pending: row.coins_pending, items_pending: row.items_pending }] : [] }
    }
    if (sql.startsWith('SELECT * FROM trading_post_offers WHERE character_id = ? AND status IN')) {
      const [characterId] = params
      const results = this.rows
        .filter((r) => r.character_id === characterId && (r.status === 'active' || r.status === 'ready_to_collect'))
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

const ITEM = {
  warped_bow: { isBossUnique: true, stackable: false },
  ring_of_endless_riches: { isClueReward: true, stackable: false },
  coins: { stackable: true },
}

// Helper: place a brand-new offer (inserts the row, then runs matching --
// the same flow /api/trading-post/list uses).
async function placeOffer(env: any, {
  characterId, offerType, itemId, price, quantity, saveObject,
}: {
  characterId: number,
  offerType: 'buy' | 'sell',
  itemId: string,
  price: number,
  quantity: number,
  saveObject: any,
}) {
  if (offerType === 'buy') escrowBuyCoins(saveObject, price * quantity)
  else escrowSellItems(saveObject, itemId, quantity)
  const offerId = await insertOffer(env, {
    characterId, offerType, itemId, price,
    quantityTotal: quantity, quantityRemaining: quantity,
  })
  const res = await executeMatching(env, {
    newOfferId: offerId!,
    newCharacterId: characterId,
    offerType,
    itemId,
    price,
    quantity,
    saveObject,
  })
  return { offerId: offerId!, res }
}

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

describe('matching engine — both sides go to ready_to_collect', () => {
  let env: any
  beforeEach(() => { env = fakeEnv() })

  it('user spec: seller lists, buyer buys -> both ready_to_collect, neither auto-delivered', async () => {
    // Seller B parks 1 warped_bow @50.
    const seller = makeSave(0, [{ itemId: 'warped_bow', quantity: 1 }])
    const { offerId: sellerOfferId } = await placeOffer(env, {
      characterId: 2, offerType: 'sell', itemId: 'warped_bow', price: 50, quantity: 1, saveObject: seller,
    })
    expect(seller.inventory.find((s: any) => s?.itemId === 'warped_bow')).toBeUndefined()

    // Buyer A walks in with cap 100 -- match at seller's 50.
    const buyer = makeSave(100)
    const { offerId: buyerOfferId, res } = await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'warped_bow', price: 100, quantity: 1, saveObject: buyer,
    })
    expect(res.totalMatched).toBe(1)
    expect(res.totalSpent).toBe(50)
    expect(res.priceImprovementRefund).toBe(50)

    // Buyer paid 100 (escrow), got 50 refund (price improvement). Net -50.
    // The matched item is NOT in their save yet -- it's on the offer row.
    expect(getCoinTotal(buyer)).toBe(50)
    expect(buyer.inventory.find((s: any) => s?.itemId === 'warped_bow')).toBeUndefined()

    const sellerOffer = env.DB.rows.find((r: any) => r.id === sellerOfferId)
    const buyerOffer = env.DB.rows.find((r: any) => r.id === buyerOfferId)
    expect(sellerOffer.status).toBe('ready_to_collect')
    expect(sellerOffer.coins_pending).toBe(50)
    expect(sellerOffer.items_pending).toBe(0)
    expect(buyerOffer.status).toBe('ready_to_collect')
    expect(buyerOffer.items_pending).toBe(1)
    expect(buyerOffer.coins_pending).toBe(0)
  })

  it('walks the book cheapest-first across multiple sells', async () => {
    await placeOffer(env, { characterId: 2, offerType: 'sell', itemId: 'warped_bow', price: 100, quantity: 5, saveObject: makeSave(0, [{ itemId: 'warped_bow', quantity: 5 }]) })
    await placeOffer(env, { characterId: 3, offerType: 'sell', itemId: 'warped_bow', price: 50, quantity: 3, saveObject: makeSave(0, [{ itemId: 'warped_bow', quantity: 3 }]) })

    const buyer = makeSave(2000)
    const { offerId, res } = await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'warped_bow', price: 200, quantity: 5, saveObject: buyer,
    })
    expect(res.totalMatched).toBe(5)
    expect(res.totalSpent).toBe(3 * 50 + 2 * 100)
    expect(res.matches).toHaveLength(2)
    expect(res.matches[0]).toMatchObject({ price: 50, quantity: 3 })
    expect(res.matches[1]).toMatchObject({ price: 100, quantity: 2 })

    // Buyer's offer holds 5 items_pending until collect.
    const buyerOffer = env.DB.rows.find((r: any) => r.id === offerId)
    expect(buyerOffer.items_pending).toBe(5)
    expect(buyerOffer.status).toBe('ready_to_collect')
  })

  it('does not match a sell offer parked above the buyer price', async () => {
    await placeOffer(env, { characterId: 2, offerType: 'sell', itemId: 'warped_bow', price: 200, quantity: 5, saveObject: makeSave(0, [{ itemId: 'warped_bow', quantity: 5 }]) })
    const buyer = makeSave(500)
    const { res } = await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'warped_bow', price: 100, quantity: 5, saveObject: buyer,
    })
    expect(res.totalMatched).toBe(0)
    expect(res.remaining).toBe(5)
  })

  it('partial fill: seller listing 100 against a 99-qty buy -> seller has 1 left', async () => {
    // Buyer parks bid for 99 @ 50.
    await placeOffer(env, { characterId: 2, offerType: 'buy', itemId: 'warped_bow', price: 50, quantity: 99, saveObject: makeSave(99 * 50) })
    // Seller lists 100 @ 50.
    const seller = makeSave(0, [{ itemId: 'warped_bow', quantity: 100 }])
    const { offerId, res } = await placeOffer(env, {
      characterId: 1, offerType: 'sell', itemId: 'warped_bow', price: 50, quantity: 100, saveObject: seller,
    })
    expect(res.totalMatched).toBe(99)
    expect(res.remaining).toBe(1)

    const sellerOffer = env.DB.rows.find((r: any) => r.id === offerId)
    expect(sellerOffer.status).toBe('active')
    expect(sellerOffer.quantity_remaining).toBe(1)
    expect(sellerOffer.coins_pending).toBe(99 * 50)
  })

  it('refuses to fill a sell below the seller floor', async () => {
    // Buyer bids low.
    await placeOffer(env, { characterId: 2, offerType: 'buy', itemId: 'warped_bow', price: 50, quantity: 5, saveObject: makeSave(250) })
    // Seller floor at 100 -- no match.
    const seller = makeSave(0, [{ itemId: 'warped_bow', quantity: 5 }])
    const { res } = await placeOffer(env, {
      characterId: 1, offerType: 'sell', itemId: 'warped_bow', price: 100, quantity: 5, saveObject: seller,
    })
    expect(res.totalMatched).toBe(0)
    expect(res.remaining).toBe(5)
  })

  it('a sell into a higher buy bid: seller takes the bid price as their earnings', async () => {
    // Buyer parks bid for 1 @ 200.
    await placeOffer(env, { characterId: 2, offerType: 'buy', itemId: 'warped_bow', price: 200, quantity: 1, saveObject: makeSave(200) })
    // Seller lists 1 @ 100 (floor).
    const seller = makeSave(0, [{ itemId: 'warped_bow', quantity: 1 }])
    const { offerId, res } = await placeOffer(env, {
      characterId: 1, offerType: 'sell', itemId: 'warped_bow', price: 100, quantity: 1, saveObject: seller,
    })
    expect(res.totalEarned).toBe(200)

    const sellerOffer = env.DB.rows.find((r: any) => r.id === offerId)
    // Coins go to seller's offer row -- collect to claim.
    expect(getCoinTotal(seller)).toBe(0)
    expect(sellerOffer.coins_pending).toBe(200)
    expect(sellerOffer.status).toBe('ready_to_collect')
  })
})

describe('collect flow', () => {
  let env: any
  beforeEach(() => { env = fakeEnv() })

  it('buyer collects -> items delivered, row deleted, listing disappears', async () => {
    await placeOffer(env, { characterId: 2, offerType: 'sell', itemId: 'warped_bow', price: 50, quantity: 1, saveObject: makeSave(0, [{ itemId: 'warped_bow', quantity: 1 }]) })
    const buyer = makeSave(100)
    const { offerId: buyerOfferId } = await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'warped_bow', price: 100, quantity: 1, saveObject: buyer,
    })
    const buyerOffer = await getOwnedOffer(env, buyerOfferId, 1)
    const buyerCollectSave = makeSave(0)
    const collected = await collectOffer(env, { offer: buyerOffer, saveObject: buyerCollectSave, itemsLookup: ITEM })
    expect(collected.itemsCollected).toBe(1)
    expect(collected.coinsCollected).toBe(0)
    expect(buyerCollectSave.inventory.find((s: any) => s?.itemId === 'warped_bow')?.quantity).toBe(1)
    // Listing is gone.
    expect(env.DB.rows.find((r: any) => r.id === buyerOfferId)).toBeUndefined()
  })

  it('seller collects -> coins delivered, row deleted, listing disappears', async () => {
    await placeOffer(env, { characterId: 2, offerType: 'sell', itemId: 'warped_bow', price: 50, quantity: 1, saveObject: makeSave(0, [{ itemId: 'warped_bow', quantity: 1 }]) })
    const buyer = makeSave(100)
    await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'warped_bow', price: 100, quantity: 1, saveObject: buyer,
    })
    // Find seller's offer and collect.
    const sellerOffer = env.DB.rows.find((r: any) => r.character_id === 2)
    const sellerCollectSave = makeSave(0)
    const collected = await collectOffer(env, { offer: sellerOffer, saveObject: sellerCollectSave, itemsLookup: ITEM })
    expect(collected.coinsCollected).toBe(50)
    expect(collected.itemsCollected).toBe(0)
    expect(getCoinTotal(sellerCollectSave)).toBe(50)
    // Listing is gone.
    expect(env.DB.rows.find((r: any) => r.id === sellerOffer.id)).toBeUndefined()
  })

  it('partial collect: row stays active, pending cleared, escrow respected', async () => {
    // Seller B parks 5 warped_bow @50.
    await placeOffer(env, { characterId: 2, offerType: 'sell', itemId: 'warped_bow', price: 50, quantity: 5, saveObject: makeSave(0, [{ itemId: 'warped_bow', quantity: 5 }]) })
    // Buyer A takes 2.
    const buyer = makeSave(200)
    await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'warped_bow', price: 100, quantity: 2, saveObject: buyer,
    })
    // Seller's offer now has remaining=3, coins_pending=100, status='active'.
    const sellerOfferRow = env.DB.rows.find((r: any) => r.character_id === 2)
    expect(sellerOfferRow.status).toBe('active')
    expect(sellerOfferRow.coins_pending).toBe(100)
    expect(sellerOfferRow.quantity_remaining).toBe(3)

    // Seller collects partial payout.
    const sellerCollectSave = makeSave(0)
    await collectOffer(env, { offer: sellerOfferRow, saveObject: sellerCollectSave, itemsLookup: ITEM })
    expect(getCoinTotal(sellerCollectSave)).toBe(100)
    const after = env.DB.rows.find((r: any) => r.id === sellerOfferRow.id)
    expect(after.status).toBe('active')
    expect(after.coins_pending).toBe(0)
    expect(after.quantity_remaining).toBe(3)
  })

  it('listOffersForCharacter only shows active + ready_to_collect (collected rows vanish)', async () => {
    await placeOffer(env, { characterId: 2, offerType: 'sell', itemId: 'warped_bow', price: 50, quantity: 1, saveObject: makeSave(0, [{ itemId: 'warped_bow', quantity: 1 }]) })
    await placeOffer(env, { characterId: 1, offerType: 'buy', itemId: 'warped_bow', price: 100, quantity: 1, saveObject: makeSave(100) })
    // Seller collects, row deleted.
    const sellerOffer = env.DB.rows.find((r: any) => r.character_id === 2)
    await collectOffer(env, { offer: sellerOffer, saveObject: makeSave(0), itemsLookup: ITEM })
    const visible = await listOffersForCharacter(env, 2)
    expect(visible).toHaveLength(0)
  })

  it('rejects collect when nothing pending and offer still active', async () => {
    const offerId = await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'warped_bow', price: 50, quantityTotal: 5, quantityRemaining: 5 })
    const offer = await getOwnedOffer(env, offerId!, 1)
    await expect(collectOffer(env, { offer, saveObject: makeSave(0), itemsLookup: ITEM }))
      .rejects.toThrow(/no coins or items to collect/i)
  })
})

describe('cancellation refunds and deletes', () => {
  let env: any
  beforeEach(() => { env = fakeEnv() })

  it('returns remaining items on sell cancel and deletes the row', async () => {
    const offerId = await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'warped_bow', price: 1000, quantityTotal: 5, quantityRemaining: 3 })
    const offer = await getOwnedOffer(env, offerId!, 1)
    const save = makeSave(0)
    await cancelOffer(env, { offer, saveObject: save, itemsLookup: ITEM })
    expect(save.inventory.find((s: any) => s?.itemId === 'warped_bow')?.quantity).toBe(3)
    expect(env.DB.rows).toHaveLength(0)
  })

  it('refunds unspent coins on buy cancel and deletes the row', async () => {
    const offerId = await insertOffer(env, { characterId: 1, offerType: 'buy', itemId: 'warped_bow', price: 1000, quantityTotal: 5, quantityRemaining: 2 })
    const offer = await getOwnedOffer(env, offerId!, 1)
    const save = makeSave(0)
    await cancelOffer(env, { offer, saveObject: save, itemsLookup: ITEM })
    expect(getCoinTotal(save)).toBe(2 * 1000)
    expect(env.DB.rows).toHaveLength(0)
  })

  it('a partially filled buy: cancel returns escrow + pending items', async () => {
    // Seller parks 2 @ 50.
    await placeOffer(env, { characterId: 2, offerType: 'sell', itemId: 'warped_bow', price: 50, quantity: 2, saveObject: makeSave(0, [{ itemId: 'warped_bow', quantity: 2 }]) })
    // Buyer wants 5 @ 100. Matches 2, parks 3.
    const buyer = makeSave(500)
    const { offerId: buyerOfferId } = await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'warped_bow', price: 100, quantity: 5, saveObject: buyer,
    })
    const buyerOffer = await getOwnedOffer(env, buyerOfferId, 1)
    expect(buyerOffer.items_pending).toBe(2)
    expect(buyerOffer.quantity_remaining).toBe(3)
    expect(buyerOffer.status).toBe('active')

    // Buyer cancels -- should get back the 2 pending items + 3*100 coins (unmatched escrow).
    const cancelSave = makeSave(0)
    await cancelOffer(env, { offer: buyerOffer, saveObject: cancelSave, itemsLookup: ITEM })
    expect(cancelSave.inventory.find((s: any) => s?.itemId === 'warped_bow')?.quantity).toBe(2)
    expect(getCoinTotal(cancelSave)).toBe(3 * 100)
    expect(env.DB.rows.find((r: any) => r.id === buyerOfferId)).toBeUndefined()
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
    expect(getCoinTotal(sellerSave)).toBe(payout)
    const row = env.DB.rows.find((r: any) => r.id === offerId)
    expect(row.character_id).toBeNull()
    expect(row.price).toBe(1000)
    expect(row.quantity_remaining).toBe(5)
  })

  it('orphan stock is matched by future buyers at the original price (gold sink)', async () => {
    const offerId = await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'warped_bow', price: 1000, quantityTotal: 2, quantityRemaining: 2 })
    const offer = await getOwnedOffer(env, offerId!, 1)
    await instantSellOffer(env, { offer, saveObject: makeSave(0), itemsLookup: ITEM })
    // Buyer comes in.
    const buyer = makeSave(10000)
    const { offerId: buyerOfferId } = await placeOffer(env, {
      characterId: 9, offerType: 'buy', itemId: 'warped_bow', price: 5000, quantity: 2, saveObject: buyer,
    })
    const buyerOffer = env.DB.rows.find((r: any) => r.id === buyerOfferId)
    expect(buyerOffer.items_pending).toBe(2)
    // Orphan row vanished: no character_id to pay, no pending to keep.
    const orphan = env.DB.rows.find((r: any) => r.id === offerId)
    expect(orphan).toBeUndefined()
  })
})

describe('slot limits', () => {
  let env: any
  beforeEach(() => { env = fakeEnv() })

  it('blocks more than MAX active offers per character', async () => {
    for (let i = 0; i < MAX_ACTIVE_OFFERS_PER_CHARACTER; i++) {
      await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'warped_bow', price: 10 + i, quantityTotal: 1, quantityRemaining: 1 })
    }
    await expect(assertSlotAvailable(env, 1)).rejects.toThrow(/active offers/i)
  })

  it('does not count ready_to_collect offers against the active-slot cap', async () => {
    for (let i = 0; i < MAX_ACTIVE_OFFERS_PER_CHARACTER - 1; i++) {
      await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'warped_bow', price: 10 + i, quantityTotal: 1, quantityRemaining: 1 })
    }
    env.DB.rows.push({
      id: 999, character_id: 1, offer_type: 'sell', item_id: 'warped_bow', price: 5,
      quantity_total: 1, quantity_remaining: 0, coins_pending: 5, items_pending: 0,
      status: 'ready_to_collect', created_at: 0, updated_at: 0,
    })
    await expect(assertSlotAvailable(env, 1)).resolves.toBeUndefined()
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
    expect(getCoinTotal(save)).toBe(200)
  })
})

describe('legacy id aliasing on the matcher', () => {
  let env: any
  beforeEach(() => { env = fakeEnv() })

  it('matches a canonical-id buy against a legacy-id sell', async () => {
    await placeOffer(env, {
      characterId: 2, offerType: 'sell', itemId: 'twisted_bow', price: 100, quantity: 1,
      saveObject: makeSave(0, [{ itemId: 'twisted_bow', quantity: 1 }]),
    })
    const buyer = makeSave(100)
    const { res } = await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'warped_bow', price: 100, quantity: 1, saveObject: buyer,
    })
    expect(res.totalMatched).toBe(1)
    expect(res.totalSpent).toBe(100)
  })

  it('matches a legacy-id buy against a canonical-id sell', async () => {
    await placeOffer(env, {
      characterId: 2, offerType: 'sell', itemId: 'warped_bow', price: 50, quantity: 1,
      saveObject: makeSave(0, [{ itemId: 'warped_bow', quantity: 1 }]),
    })
    const buyer = makeSave(100)
    const { res } = await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'twisted_bow', price: 100, quantity: 1, saveObject: buyer,
    })
    expect(res.totalMatched).toBe(1)
  })
})

describe('OFFER_STATUS constants', () => {
  it('exports active and ready_to_collect (no completed/cancelled)', () => {
    expect(OFFER_STATUS.ACTIVE).toBe('active')
    expect(OFFER_STATUS.READY_TO_COLLECT).toBe('ready_to_collect')
  })
})
