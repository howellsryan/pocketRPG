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
  autoFillSellAtShopValue,
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
    if (sql.startsWith('UPDATE trading_post_offers SET coins_pending = coins_pending + ?, quantity_remaining = quantity_remaining - ?, updated_at = ? WHERE id = ? AND quantity_remaining >= ? AND status = \'active\' AND character_id IS NOT NULL')) {
      // Seller-side decrement (non-orphan). Conditional on remaining >=
      // tradeQty so concurrent fills can't both succeed against the
      // same row.
      const [delta, tradeQty, updatedAt, id, minRemaining] = params
      const row = this.rows.find((r) => r.id === id)
      if (!row || row.status !== 'active' || row.character_id == null || (Number(row.quantity_remaining) || 0) < minRemaining) {
        return { meta: { changes: 0 } }
      }
      row.coins_pending = (row.coins_pending || 0) + delta
      row.quantity_remaining = (Number(row.quantity_remaining) || 0) - tradeQty
      row.updated_at = updatedAt
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith('UPDATE trading_post_offers SET items_pending = items_pending + ?, coins_pending = coins_pending + ?, quantity_remaining = quantity_remaining - ?, updated_at = ? WHERE id = ? AND quantity_remaining >= ? AND status = \'active\'')) {
      // Buyer-side decrement.
      const [deltaItems, deltaCoins, tradeQty, updatedAt, id, minRemaining] = params
      const row = this.rows.find((r) => r.id === id)
      if (!row || row.status !== 'active' || (Number(row.quantity_remaining) || 0) < minRemaining) {
        return { meta: { changes: 0 } }
      }
      row.items_pending = (row.items_pending || 0) + deltaItems
      row.coins_pending = (row.coins_pending || 0) + deltaCoins
      row.quantity_remaining = (Number(row.quantity_remaining) || 0) - tradeQty
      row.updated_at = updatedAt
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith('UPDATE trading_post_offers SET quantity_remaining = quantity_remaining - ?, updated_at = ? WHERE id = ? AND quantity_remaining >= ? AND status = \'active\' AND character_id IS NULL')) {
      // Orphan-side decrement (no coins credited, no character to pay).
      const [tradeQty, updatedAt, id, minRemaining] = params
      const row = this.rows.find((r) => r.id === id)
      if (!row || row.status !== 'active' || row.character_id != null || (Number(row.quantity_remaining) || 0) < minRemaining) {
        return { meta: { changes: 0 } }
      }
      row.quantity_remaining = (Number(row.quantity_remaining) || 0) - tradeQty
      row.updated_at = updatedAt
      return { meta: { changes: 1 } }
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
    if (sql.startsWith('UPDATE trading_post_offers SET character_id = NULL, price = ?')) {
      // Instant-sell orphan: re-prices the row to shopValue, and is
      // conditional on still owning the row and remaining quantity matching,
      // so a buyer mid-match can't get credited twice.
      const [price, updatedAt, id, quantityRemaining] = params
      const row = this.rows.find((r) => r.id === id)
      if (!row || row.character_id == null || row.status !== 'active' || row.quantity_remaining !== quantityRemaining) {
        return { meta: { changes: 0 } }
      }
      row.character_id = null
      row.price = price
      row.coins_pending = 0
      row.items_pending = 0
      row.updated_at = updatedAt
      return { meta: { changes: 1 } }
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
      const n = this.rows.filter((r) => r.character_id === characterId && r.status === 'active' && !(Number(r.quantity_remaining) === 0 && ((Number(r.coins_pending) || 0) > 0 || (Number(r.items_pending) || 0) > 0))).length
      return { results: [{ n }] }
    }
    const sellMatch = sql.match(/^SELECT \* FROM trading_post_offers WHERE item_id IN \((\?(?:,\?)*)\) AND offer_type = 'sell' AND status = 'active' AND price <= \?/)
    if (sellMatch) {
      const idCount = sellMatch[1].split(',').length
      const itemIds = params.slice(0, idCount)
      const maxPrice = params[idCount]
      // Match new self-trade exclusion: last param is the excludeCharacterId.
      const excludeChar = sql.includes('character_id IS NULL OR character_id != ?') ? params[idCount + 1] : null
      const results = this.rows
        .filter((r) => itemIds.includes(r.item_id) && r.offer_type === 'sell' && r.status === 'active' && r.price <= maxPrice && (excludeChar == null || r.character_id == null || r.character_id !== excludeChar))
        .sort((a, b) => a.price - b.price || a.created_at - b.created_at)
      return { results }
    }
    const buyMatch = sql.match(/^SELECT \* FROM trading_post_offers WHERE item_id IN \((\?(?:,\?)*)\) AND offer_type = 'buy' AND status = 'active' AND price >= \?/)
    if (buyMatch) {
      const idCount = buyMatch[1].split(',').length
      const itemIds = params.slice(0, idCount)
      const minPrice = params[idCount]
      const excludeChar = sql.includes('character_id != ?') ? params[idCount + 1] : null
      const results = this.rows
        .filter((r) => itemIds.includes(r.item_id) && r.offer_type === 'buy' && r.status === 'active' && r.price >= minPrice && (excludeChar == null || r.character_id !== excludeChar))
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
    if (sql.startsWith("SELECT * FROM trading_post_offers WHERE character_id = ? AND status = 'active'")) {
      const [characterId] = params
      const results = this.rows
        .filter((r) => r.character_id === characterId && r.status === 'active')
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
  twisted_longbow: { isBossUnique: true, stackable: false, shopValue: 600 },
  ring_of_endless_riches: { isClueReward: true, stackable: false, shopValue: 100 },
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
    // Order-book migration: ordinary tradeable items are order-book too.
    expect(isOrderBookItem({ shopValue: 100 })).toBe(true)
    expect(isOrderBookItem({ shopValue: 100, questUnlock: 'the_lost_blade' })).toBe(false)
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

describe('matching engine — ready-to-collect inferred from pending+remaining', () => {
  let env: any
  beforeEach(() => { env = fakeEnv() })

  it('user spec: seller lists, buyer buys -> both become collectible, neither auto-delivered', async () => {
    // Seller B parks 1 twisted_longbow @50.
    const seller = makeSave(0, [{ itemId: 'twisted_longbow', quantity: 1 }])
    const { offerId: sellerOfferId } = await placeOffer(env, {
      characterId: 2, offerType: 'sell', itemId: 'twisted_longbow', price: 50, quantity: 1, saveObject: seller,
    })
    expect(seller.inventory.find((s: any) => s?.itemId === 'twisted_longbow')).toBeUndefined()

    // Buyer A walks in with cap 100 -- match at seller's 50.
    const buyer = makeSave(100)
    const { offerId: buyerOfferId, res } = await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'twisted_longbow', price: 100, quantity: 1, saveObject: buyer,
    })
    expect(res.totalMatched).toBe(1)
    expect(res.totalSpent).toBe(50)
    expect(res.priceImprovementRefund).toBe(50)

    // Buyer paid 100 (escrow), got 50 refund (price improvement). Net -50.
    // The matched item is NOT in their save yet -- it's on the offer row.
    expect(getCoinTotal(buyer)).toBe(50)
    expect(buyer.inventory.find((s: any) => s?.itemId === 'twisted_longbow')).toBeUndefined()

    const sellerOffer = env.DB.rows.find((r: any) => r.id === sellerOfferId)
    const buyerOffer = env.DB.rows.find((r: any) => r.id === buyerOfferId)
    expect(sellerOffer.status).toBe('active')
    expect(sellerOffer.coins_pending).toBe(50)
    expect(sellerOffer.items_pending).toBe(0)
    expect(buyerOffer.status).toBe('active')
    expect(buyerOffer.items_pending).toBe(1)
    expect(buyerOffer.coins_pending).toBe(50)
  })

  it('walks the book cheapest-first across multiple sells', async () => {
    await placeOffer(env, { characterId: 2, offerType: 'sell', itemId: 'twisted_longbow', price: 100, quantity: 5, saveObject: makeSave(0, [{ itemId: 'twisted_longbow', quantity: 5 }]) })
    await placeOffer(env, { characterId: 3, offerType: 'sell', itemId: 'twisted_longbow', price: 50, quantity: 3, saveObject: makeSave(0, [{ itemId: 'twisted_longbow', quantity: 3 }]) })

    const buyer = makeSave(2000)
    const { offerId, res } = await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'twisted_longbow', price: 200, quantity: 5, saveObject: buyer,
    })
    expect(res.totalMatched).toBe(5)
    expect(res.totalSpent).toBe(3 * 50 + 2 * 100)
    expect(res.matches).toHaveLength(2)
    expect(res.matches[0]).toMatchObject({ price: 50, quantity: 3 })
    expect(res.matches[1]).toMatchObject({ price: 100, quantity: 2 })

    // Buyer's offer holds 5 items_pending until collect.
    const buyerOffer = env.DB.rows.find((r: any) => r.id === offerId)
    expect(buyerOffer.items_pending).toBe(5)
    expect(buyerOffer.status).toBe('active')
  })

  it('does not match a sell offer parked above the buyer price', async () => {
    await placeOffer(env, { characterId: 2, offerType: 'sell', itemId: 'twisted_longbow', price: 200, quantity: 5, saveObject: makeSave(0, [{ itemId: 'twisted_longbow', quantity: 5 }]) })
    const buyer = makeSave(500)
    const { res } = await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'twisted_longbow', price: 100, quantity: 5, saveObject: buyer,
    })
    expect(res.totalMatched).toBe(0)
    expect(res.remaining).toBe(5)
  })

  it('partial fill: seller listing 100 against a 99-qty buy -> seller has 1 left', async () => {
    // Buyer parks bid for 99 @ 50.
    await placeOffer(env, { characterId: 2, offerType: 'buy', itemId: 'twisted_longbow', price: 50, quantity: 99, saveObject: makeSave(99 * 50) })
    // Seller lists 100 @ 50.
    const seller = makeSave(0, [{ itemId: 'twisted_longbow', quantity: 100 }])
    const { offerId, res } = await placeOffer(env, {
      characterId: 1, offerType: 'sell', itemId: 'twisted_longbow', price: 50, quantity: 100, saveObject: seller,
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
    await placeOffer(env, { characterId: 2, offerType: 'buy', itemId: 'twisted_longbow', price: 50, quantity: 5, saveObject: makeSave(250) })
    // Seller floor at 100 -- no match.
    const seller = makeSave(0, [{ itemId: 'twisted_longbow', quantity: 5 }])
    const { res } = await placeOffer(env, {
      characterId: 1, offerType: 'sell', itemId: 'twisted_longbow', price: 100, quantity: 5, saveObject: seller,
    })
    expect(res.totalMatched).toBe(0)
    expect(res.remaining).toBe(5)
  })

  it('a sell into a higher buy bid: seller fills at resting bid price', async () => {
    // Buyer parks bid for 1 @ 200.
    await placeOffer(env, { characterId: 2, offerType: 'buy', itemId: 'twisted_longbow', price: 200, quantity: 1, saveObject: makeSave(200) })
    // Seller lists 1 @ 100 (floor).
    const seller = makeSave(0, [{ itemId: 'twisted_longbow', quantity: 1 }])
    const { offerId, res } = await placeOffer(env, {
      characterId: 1, offerType: 'sell', itemId: 'twisted_longbow', price: 100, quantity: 1, saveObject: seller,
    })
    expect(res.totalEarned).toBe(200)

    const sellerOffer = env.DB.rows.find((r: any) => r.id === offerId)
    // Coins go to seller's offer row -- collect to claim.
    expect(getCoinTotal(seller)).toBe(0)
    expect(sellerOffer.coins_pending).toBe(200)
    expect(sellerOffer.status).toBe('active')
  })
})

describe('collect flow', () => {
  let env: any
  beforeEach(() => { env = fakeEnv() })

  it('buyer collects -> items delivered, row deleted, listing disappears', async () => {
    await placeOffer(env, { characterId: 2, offerType: 'sell', itemId: 'twisted_longbow', price: 50, quantity: 1, saveObject: makeSave(0, [{ itemId: 'twisted_longbow', quantity: 1 }]) })
    const buyer = makeSave(100)
    const { offerId: buyerOfferId } = await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'twisted_longbow', price: 100, quantity: 1, saveObject: buyer,
    })
    const buyerOffer = await getOwnedOffer(env, buyerOfferId, 1)
    const buyerCollectSave = makeSave(0)
    const collected = await collectOffer(env, { offer: buyerOffer, saveObject: buyerCollectSave, itemsLookup: ITEM })
    expect(collected.itemsCollected).toBe(1)
    expect(collected.coinsCollected).toBe(0)
    expect(buyerCollectSave.inventory.find((s: any) => s?.itemId === 'twisted_longbow')?.quantity).toBe(1)
    // Listing is gone.
    expect(env.DB.rows.find((r: any) => r.id === buyerOfferId)).toBeUndefined()
  })

  it('seller collects -> coins delivered, row deleted, listing disappears', async () => {
    await placeOffer(env, { characterId: 2, offerType: 'sell', itemId: 'twisted_longbow', price: 50, quantity: 1, saveObject: makeSave(0, [{ itemId: 'twisted_longbow', quantity: 1 }]) })
    const buyer = makeSave(100)
    await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'twisted_longbow', price: 100, quantity: 1, saveObject: buyer,
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
    // Seller B parks 5 twisted_longbow @50.
    await placeOffer(env, { characterId: 2, offerType: 'sell', itemId: 'twisted_longbow', price: 50, quantity: 5, saveObject: makeSave(0, [{ itemId: 'twisted_longbow', quantity: 5 }]) })
    // Buyer A takes 2.
    const buyer = makeSave(200)
    await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'twisted_longbow', price: 100, quantity: 2, saveObject: buyer,
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

  it('listOffersForCharacter only shows active rows (collected rows vanish)', async () => {
    await placeOffer(env, { characterId: 2, offerType: 'sell', itemId: 'twisted_longbow', price: 50, quantity: 1, saveObject: makeSave(0, [{ itemId: 'twisted_longbow', quantity: 1 }]) })
    await placeOffer(env, { characterId: 1, offerType: 'buy', itemId: 'twisted_longbow', price: 100, quantity: 1, saveObject: makeSave(100) })
    // Seller collects, row deleted.
    const sellerOffer = env.DB.rows.find((r: any) => r.character_id === 2)
    await collectOffer(env, { offer: sellerOffer, saveObject: makeSave(0), itemsLookup: ITEM })
    const visible = await listOffersForCharacter(env, 2)
    expect(visible).toHaveLength(0)
  })

  it('rejects collect when nothing pending and offer still active', async () => {
    const offerId = await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'twisted_longbow', price: 50, quantityTotal: 5, quantityRemaining: 5 })
    const offer = await getOwnedOffer(env, offerId!, 1)
    await expect(collectOffer(env, { offer, saveObject: makeSave(0), itemsLookup: ITEM }))
      .rejects.toThrow(/no coins or items to collect/i)
  })
})

describe('cancellation refunds and deletes', () => {
  let env: any
  beforeEach(() => { env = fakeEnv() })

  it('returns remaining items on sell cancel and deletes the row', async () => {
    const offerId = await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'twisted_longbow', price: 1000, quantityTotal: 5, quantityRemaining: 3 })
    const offer = await getOwnedOffer(env, offerId!, 1)
    const save = makeSave(0)
    await cancelOffer(env, { offer, saveObject: save, itemsLookup: ITEM })
    expect(save.inventory.find((s: any) => s?.itemId === 'twisted_longbow')?.quantity).toBe(3)
    expect(env.DB.rows).toHaveLength(0)
  })

  it('refunds unspent coins on buy cancel and deletes the row', async () => {
    const offerId = await insertOffer(env, { characterId: 1, offerType: 'buy', itemId: 'twisted_longbow', price: 1000, quantityTotal: 5, quantityRemaining: 2 })
    const offer = await getOwnedOffer(env, offerId!, 1)
    const save = makeSave(0)
    await cancelOffer(env, { offer, saveObject: save, itemsLookup: ITEM })
    expect(getCoinTotal(save)).toBe(2 * 1000)
    expect(env.DB.rows).toHaveLength(0)
  })

  it('a partially filled buy: cancel returns escrow + pending items', async () => {
    // Seller parks 2 @ 50.
    await placeOffer(env, { characterId: 2, offerType: 'sell', itemId: 'twisted_longbow', price: 50, quantity: 2, saveObject: makeSave(0, [{ itemId: 'twisted_longbow', quantity: 2 }]) })
    // Buyer wants 5 @ 100. Matches 2, parks 3.
    const buyer = makeSave(500)
    const { offerId: buyerOfferId } = await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'twisted_longbow', price: 100, quantity: 5, saveObject: buyer,
    })
    const buyerOffer = await getOwnedOffer(env, buyerOfferId, 1)
    expect(buyerOffer.items_pending).toBe(2)
    expect(buyerOffer.coins_pending).toBe(100)
    expect(buyerOffer.quantity_remaining).toBe(3)
    expect(buyerOffer.status).toBe('active')

    // Buyer cancels -- should get back the 2 pending items + 3*100 coins (unmatched escrow).
    const cancelSave = makeSave(0)
    await cancelOffer(env, { offer: buyerOffer, saveObject: cancelSave, itemsLookup: ITEM })
    expect(cancelSave.inventory.find((s: any) => s?.itemId === 'twisted_longbow')?.quantity).toBe(2)
    expect(getCoinTotal(cancelSave)).toBe(3 * 100)
    expect(env.DB.rows.find((r: any) => r.id === buyerOfferId)).toBeUndefined()
  })
})

describe('orphan stock (instant sell)', () => {
  let env: any
  beforeEach(() => { env = fakeEnv() })

  it('pays seller 80% of shopValue (not the listed price) and detaches character_id', async () => {
    // Listed price 1000, but shopValue is 600. Payout must follow shopValue.
    const offerId = await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'twisted_longbow', price: 1000, quantityTotal: 5, quantityRemaining: 5 })
    const offer = await getOwnedOffer(env, offerId!, 1)
    const sellerSave = makeSave(0)
    const payout = await instantSellOffer(env, { offer, saveObject: sellerSave, itemsLookup: ITEM })
    expect(payout).toBe(Math.floor(5 * ITEM.twisted_longbow.shopValue * INSTANT_SELL_PAYOUT_FRACTION))
    expect(getCoinTotal(sellerSave)).toBe(payout)
    const row = env.DB.rows.find((r: any) => r.id === offerId)
    expect(row.character_id).toBeNull()
    // Orphan is re-priced down to shopValue (no longer the 1000 listed price).
    expect(row.price).toBe(ITEM.twisted_longbow.shopValue)
    expect(row.quantity_remaining).toBe(5)
  })

  it('cannot be gamed by listing at an absurd price (payout ignores price)', async () => {
    // Player lists at 100 billion then instant-sells. Payout is bounded to
    // 80% of shopValue, NOT 80% of the inflated listing price.
    const absurdPrice = 100_000_000_000
    const offerId = await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'twisted_longbow', price: absurdPrice, quantityTotal: 1, quantityRemaining: 1 })
    const offer = await getOwnedOffer(env, offerId!, 1)
    const sellerSave = makeSave(0)
    const payout = await instantSellOffer(env, { offer, saveObject: sellerSave, itemsLookup: ITEM })
    expect(payout).toBe(Math.floor(ITEM.twisted_longbow.shopValue * INSTANT_SELL_PAYOUT_FRACTION))
    expect(payout).toBeLessThan(absurdPrice)
  })

  it('orphan stock rests at shopValue and is matched by future buyers at that price', async () => {
    const offerId = await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'twisted_longbow', price: 1000, quantityTotal: 2, quantityRemaining: 2 })
    const offer = await getOwnedOffer(env, offerId!, 1)
    await instantSellOffer(env, { offer, saveObject: makeSave(0), itemsLookup: ITEM })
    // Orphan now rests at shopValue, not the 1000 listed price.
    const orphanBefore = env.DB.rows.find((r: any) => r.id === offerId)
    expect(orphanBefore.price).toBe(ITEM.twisted_longbow.shopValue)
    // Buyer comes in and pays the resting shopValue price (price improvement
    // refunds the difference between their bid and the orphan price).
    const buyer = makeSave(10000)
    const { offerId: buyerOfferId, res } = await placeOffer(env, {
      characterId: 9, offerType: 'buy', itemId: 'twisted_longbow', price: 5000, quantity: 2, saveObject: buyer,
    })
    expect(res.totalSpent).toBe(2 * ITEM.twisted_longbow.shopValue)
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
      await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'twisted_longbow', price: 10 + i, quantityTotal: 1, quantityRemaining: 1 })
    }
    await expect(assertSlotAvailable(env, 1)).rejects.toThrow(/active offers/i)
  })

  it('does not count collectible offers against the active-slot cap', async () => {
    for (let i = 0; i < MAX_ACTIVE_OFFERS_PER_CHARACTER - 1; i++) {
      await insertOffer(env, { characterId: 1, offerType: 'sell', itemId: 'twisted_longbow', price: 10 + i, quantityTotal: 1, quantityRemaining: 1 })
    }
    env.DB.rows.push({
      id: 999, character_id: 1, offer_type: 'sell', item_id: 'twisted_longbow', price: 5,
      quantity_total: 1, quantity_remaining: 0, coins_pending: 5, items_pending: 0,
      status: 'active', created_at: 0, updated_at: 0,
    })
    await expect(assertSlotAvailable(env, 1)).resolves.toBeUndefined()
  })
})

describe('escrow primitives', () => {
  it('escrowSellItems removes from inventory', () => {
    const save = makeSave(0, [{ itemId: 'twisted_longbow', quantity: 5 }])
    escrowSellItems(save, 'twisted_longbow', 3)
    expect(save.inventory[0].quantity).toBe(2)
  })

  it("escrowSellItems with source 'bank' removes from the bank, not inventory", () => {
    const save = makeSave(0, [{ itemId: 'twisted_longbow', quantity: 5 }])
    save.bank = { twisted_longbow: { itemId: 'twisted_longbow', quantity: 9 } }
    escrowSellItems(save, 'twisted_longbow', 4, 'bank')
    // Bank debited, inventory copies untouched
    expect(save.bank.twisted_longbow.quantity).toBe(5)
    expect(save.inventory[0].quantity).toBe(5)
  })

  it("escrowSellItems with source 'bank' validates against the bank balance only", () => {
    const save = makeSave(0, [{ itemId: 'twisted_longbow', quantity: 5 }])
    save.bank = { twisted_longbow: { itemId: 'twisted_longbow', quantity: 2 } }
    // 5 in inventory must NOT count toward a bank sell of 3
    expect(() => escrowSellItems(save, 'twisted_longbow', 3, 'bank')).toThrow(/bank/)
    expect(save.bank.twisted_longbow.quantity).toBe(2)
    expect(save.inventory[0].quantity).toBe(5)
  })

  it("escrowSellItems with source 'bank' deletes the bank entry when fully sold", () => {
    const save = makeSave(0, [])
    save.bank = { twisted_longbow: { itemId: 'twisted_longbow', quantity: 3 } }
    escrowSellItems(save, 'twisted_longbow', 3, 'bank')
    expect(save.bank.twisted_longbow).toBeUndefined()
  })

  it('escrowBuyCoins subtracts from coins (inventory + bank)', () => {
    const save = makeSave(1000)
    escrowBuyCoins(save, 800)
    expect(getCoinTotal(save)).toBe(200)
  })

  it('escrowBuyCoins cannot spend bank coins without the money purse', () => {
    const save = { coins: 0, inventory: [], bank: { coins: { quantity: 1000 } } } as any
    expect(() => escrowBuyCoins(save, 800)).toThrow(/Insufficient/)
    expect(save.bank.coins.quantity).toBe(1000)
  })

  it('escrowBuyCoins spends bank coins once the money purse is unlocked', () => {
    const save = { coins: 0, inventory: [], bank: { coins: { quantity: 1000 } }, settings: { unlockedFeatures: ['money_purse'] } } as any
    escrowBuyCoins(save, 800)
    expect(getCoinTotal(save)).toBe(200)
    expect(save.bank.coins.quantity).toBe(200)
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
      characterId: 1, offerType: 'buy', itemId: 'twisted_longbow', price: 100, quantity: 1, saveObject: buyer,
    })
    expect(res.totalMatched).toBe(1)
    expect(res.totalSpent).toBe(100)
  })

  it('matches a legacy-id buy against a canonical-id sell', async () => {
    await placeOffer(env, {
      characterId: 2, offerType: 'sell', itemId: 'twisted_longbow', price: 50, quantity: 1,
      saveObject: makeSave(0, [{ itemId: 'twisted_longbow', quantity: 1 }]),
    })
    const buyer = makeSave(100)
    const { res } = await placeOffer(env, {
      characterId: 1, offerType: 'buy', itemId: 'twisted_bow', price: 100, quantity: 1, saveObject: buyer,
    })
    expect(res.totalMatched).toBe(1)
  })
})

describe('OFFER_STATUS constants', () => {
  it('exports active status (no completed/cancelled)', () => {
    expect(OFFER_STATUS.ACTIVE).toBe('active')
  })
})

describe('autoFillSellAtShopValue (quest-shop auto-sell)', () => {
  // Since the order-book migration every ordinary tradeable item IS an
  // order-book item, so only quest-unlock items reach the auto-fill path —
  // their quest shop keeps buying/selling at fixed shopValue prices.
  it('removes items from inventory and credits coins at shopValue × quantity', () => {
    const item = { shopValue: 50, stackable: false, questUnlock: 'the_lost_blade' }
    const save = makeSave(0, [{ itemId: 'dragon_dagger', quantity: 3 }])
    const { unit, totalPayout } = autoFillSellAtShopValue(save, item, 'dragon_dagger', 3)
    expect(unit).toBe(50)
    expect(totalPayout).toBe(150)
    expect(getCoinTotal(save)).toBe(150)
    expect(save.inventory.find((s: any) => s?.itemId === 'dragon_dagger')).toBeUndefined()
  })

  it('ignores any caller-supplied price and always pays floor(shopValue)', () => {
    const item = { shopValue: 12.9, stackable: true, questUnlock: 'the_lost_blade' }
    const save = makeSave(0, [{ itemId: 'dragon_dart', quantity: 10 }])
    const { unit, totalPayout } = autoFillSellAtShopValue(save, item, 'dragon_dart', 10)
    expect(unit).toBe(12)
    expect(totalPayout).toBe(120)
    expect(getCoinTotal(save)).toBe(120)
  })

  it('rejects boss uniques (must go through the matching engine)', () => {
    const item = { isBossUnique: true, shopValue: 100 }
    const save = makeSave(0, [{ itemId: 'twisted_longbow', quantity: 1 }])
    expect(() => autoFillSellAtShopValue(save, item, 'twisted_longbow', 1)).toThrow(/Order book/)
  })

  it('rejects ordinary tradeable items — they are order-book items now', () => {
    const item = { shopValue: 50, stackable: false }
    const save = makeSave(0, [{ itemId: 'bronze_dagger', quantity: 3 }])
    expect(() => autoFillSellAtShopValue(save, item, 'bronze_dagger', 1)).toThrow(/Order book/)
  })

  it('rejects items with no shopValue', () => {
    const item = { shopValue: 0 }
    const save = makeSave(0, [{ itemId: 'bones', quantity: 1 }])
    expect(() => autoFillSellAtShopValue(save, item, 'bones', 1)).toThrow(/no shop value/)
  })

  it("source 'bank' removes from the bank and ignores inventory copies", () => {
    const item = { shopValue: 50, stackable: false, questUnlock: 'the_lost_blade' }
    const save = makeSave(0, [{ itemId: 'dragon_dagger', quantity: 2 }])
    save.bank = { dragon_dagger: { itemId: 'dragon_dagger', quantity: 4 } }
    const { totalPayout } = autoFillSellAtShopValue(save, item, 'dragon_dagger', 3, 'bank')
    expect(totalPayout).toBe(150)
    expect(getCoinTotal(save)).toBe(150)
    // Bank debited by 3; the 2 inventory copies are untouched
    expect(save.bank.dragon_dagger.quantity).toBe(1)
    expect(save.inventory.find((s: any) => s?.itemId === 'dragon_dagger')?.quantity).toBe(2)
  })

  it("source 'bank' validates against the bank balance, not inventory", () => {
    const item = { shopValue: 50, stackable: true, questUnlock: 'the_lost_blade' }
    const save = makeSave(0, [{ itemId: 'dragon_dart', quantity: 100 }])
    save.bank = { dragon_dart: { itemId: 'dragon_dart', quantity: 5 } }
    expect(() => autoFillSellAtShopValue(save, item, 'dragon_dart', 10, 'bank')).toThrow(/bank/)
    expect(getCoinTotal(save)).toBe(0)
    expect(save.bank.dragon_dart.quantity).toBe(5)
  })
})

describe('order-book migration — isOrderBookItem / isTradingPostListable', () => {
  it('ordinary tradeable items with a shop value are order-book items', () => {
    expect(isOrderBookItem({ shopValue: 50 })).toBe(true)
    expect(isOrderBookItem({ shopValue: 1, stackable: true })).toBe(true)
  })

  it('uniques remain order-book items regardless of shopValue', () => {
    expect(isOrderBookItem({ isBossUnique: true, shopValue: 0 })).toBe(true)
    expect(isOrderBookItem({ isClueReward: true })).toBe(true)
    expect(isOrderBookItem({ isRaidUnique: true })).toBe(true)
  })

  it('quest-unlock items stay on the immediate-execute quest shop path', () => {
    expect(isOrderBookItem({ shopValue: 30000, questUnlock: 'the_lost_blade' })).toBe(false)
    expect(isTradingPostListable({ shopValue: 30000, questUnlock: 'the_lost_blade' })).toBe(true)
  })

  it('untradeables and valueless items stay off the order book', () => {
    expect(isOrderBookItem({ isUntradeable: true, shopValue: 500 })).toBe(false)
    expect(isOrderBookItem({ shopValue: 0 })).toBe(false)
  })

  it('General Store stock stays on the immediate-execute store path', () => {
    expect(isOrderBookItem({ shopValue: 100, isGeneralStore: true })).toBe(false)
    // Still passes the list gate so sell listings auto-fill at shopValue.
    expect(isTradingPostListable({ shopValue: 100, isGeneralStore: true })).toBe(true)
  })
})
