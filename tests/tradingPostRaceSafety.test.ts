import { describe, it, expect } from 'vitest'
import { executeMatching, insertOffer } from '../functions/_lib/game/tradingPost.js'

// Tiny FakeDB modelled on tradingPost.test.ts but lets us seed offers
// owned by other characters and inspect post-fill state. Differs from
// the main suite mock in that it returns deterministic state across
// concurrent fills so we can prove the relative-decrement UPDATE
// correctly rejects double-spends.
class FakeDB {
  rows: any[] = []
  nextId = 1

  prepare(stmt: string) {
    const sql = stmt.trim().replace(/\s+/g, ' ')
    const db = this
    return {
      params: [] as any[],
      bind(...args: any[]) { this.params = args; return this },
      async run() { return db._run(sql, this.params) },
      async first() { const r = await db._all(sql, this.params); return r.results[0] || null },
      async all() { return db._all(sql, this.params) },
    }
  }

  seedOffer(row: any) {
    const id = this.nextId++
    this.rows.push({
      id,
      character_id: row.character_id ?? 1,
      offer_type: row.offer_type,
      item_id: row.item_id,
      price: row.price,
      quantity_total: row.quantity_remaining,
      quantity_remaining: row.quantity_remaining,
      coins_pending: 0,
      items_pending: 0,
      status: 'active',
      created_at: row.created_at ?? Date.now(),
      updated_at: row.created_at ?? Date.now(),
    })
    return id
  }

  private async _run(sql: string, params: any[]) {
    if (sql.startsWith('INSERT INTO trading_post_offers')) {
      const [characterId, offerType, itemId, price, qTotal, qRem, status, createdAt, updatedAt] = params
      const id = this.nextId++
      this.rows.push({ id, character_id: characterId, offer_type: offerType, item_id: itemId, price, quantity_total: qTotal, quantity_remaining: qRem, coins_pending: 0, items_pending: 0, status, created_at: createdAt, updated_at: updatedAt })
      return { meta: { last_row_id: id, changes: 1 } }
    }
    if (sql.startsWith("UPDATE trading_post_offers SET coins_pending = coins_pending + ?, quantity_remaining = quantity_remaining - ?, updated_at = ? WHERE id = ? AND quantity_remaining >= ? AND status = 'active' AND character_id IS NOT NULL")) {
      const [delta, tradeQty, updatedAt, id, minRem] = params
      const row = this.rows.find(r => r.id === id)
      if (!row || row.status !== 'active' || row.character_id == null || row.quantity_remaining < minRem) return { meta: { changes: 0 } }
      row.coins_pending += delta
      row.quantity_remaining -= tradeQty
      row.updated_at = updatedAt
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith("UPDATE trading_post_offers SET items_pending = items_pending + ?, coins_pending = coins_pending + ?, quantity_remaining = quantity_remaining - ?, updated_at = ? WHERE id = ? AND quantity_remaining >= ? AND status = 'active'")) {
      const [deltaItems, deltaCoins, tradeQty, updatedAt, id, minRem] = params
      const row = this.rows.find(r => r.id === id)
      if (!row || row.status !== 'active' || row.quantity_remaining < minRem) return { meta: { changes: 0 } }
      row.items_pending += deltaItems
      row.coins_pending += deltaCoins
      row.quantity_remaining -= tradeQty
      row.updated_at = updatedAt
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith("UPDATE trading_post_offers SET quantity_remaining = quantity_remaining - ?, updated_at = ? WHERE id = ? AND quantity_remaining >= ? AND status = 'active' AND character_id IS NULL")) {
      const [tradeQty, updatedAt, id, minRem] = params
      const row = this.rows.find(r => r.id === id)
      if (!row || row.status !== 'active' || row.character_id != null || row.quantity_remaining < minRem) return { meta: { changes: 0 } }
      row.quantity_remaining -= tradeQty
      row.updated_at = updatedAt
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith('DELETE FROM trading_post_offers WHERE id = ?')) {
      const [id] = params
      const idx = this.rows.findIndex(r => r.id === id)
      if (idx >= 0) this.rows.splice(idx, 1)
      return { meta: { changes: idx >= 0 ? 1 : 0 } }
    }
    return { meta: { changes: 0 } }
  }

  private async _all(sql: string, params: any[]) {
    if (sql.startsWith("SELECT COUNT(*) AS n FROM trading_post_offers WHERE character_id = ? AND status = 'active'")) {
      const [characterId] = params
      const n = this.rows.filter(r => r.character_id === characterId && r.status === 'active').length
      return { results: [{ n }] }
    }
    const sellMatch = sql.match(/^SELECT \* FROM trading_post_offers WHERE item_id IN \((\?(?:,\?)*)\) AND offer_type = 'sell' AND status = 'active' AND price <= \?/)
    if (sellMatch) {
      const idCount = sellMatch[1].split(',').length
      const itemIds = params.slice(0, idCount)
      const maxPrice = params[idCount]
      const excludeChar = params[idCount + 1]
      const results = this.rows
        .filter(r => itemIds.includes(r.item_id) && r.offer_type === 'sell' && r.status === 'active' && r.price <= maxPrice && (excludeChar == null || r.character_id == null || r.character_id !== excludeChar))
        .sort((a, b) => a.price - b.price || a.created_at - b.created_at)
      return { results }
    }
    const buyMatch = sql.match(/^SELECT \* FROM trading_post_offers WHERE item_id IN \((\?(?:,\?)*)\) AND offer_type = 'buy' AND status = 'active' AND price >= \?/)
    if (buyMatch) {
      const idCount = buyMatch[1].split(',').length
      const itemIds = params.slice(0, idCount)
      const minPrice = params[idCount]
      const excludeChar = params[idCount + 1]
      const results = this.rows
        .filter(r => itemIds.includes(r.item_id) && r.offer_type === 'buy' && r.status === 'active' && r.price >= minPrice && (excludeChar == null || r.character_id !== excludeChar))
        .sort((a, b) => b.price - a.price || a.created_at - b.created_at)
      return { results }
    }
    if (sql.startsWith('SELECT quantity_remaining, coins_pending, items_pending FROM trading_post_offers WHERE id = ?')) {
      const [id] = params
      const row = this.rows.find(r => r.id === id)
      return { results: row ? [{ quantity_remaining: row.quantity_remaining, coins_pending: row.coins_pending, items_pending: row.items_pending }] : [] }
    }
    return { results: [] }
  }
}

describe('trading post race safety', () => {
  it('rejects self-trades — opposing offers owned by the new offer character are excluded', async () => {
    const env: any = { DB: new FakeDB() }
    const myCharId = 7
    // Seed a sell from myself.
    env.DB.seedOffer({ character_id: myCharId, offer_type: 'sell', item_id: 'feather', price: 100, quantity_remaining: 50 })

    // Insert a buy from myself trying to match against my own sell.
    const newOfferId = await insertOffer(env, {
      characterId: myCharId,
      offerType: 'buy',
      itemId: 'feather',
      price: 100,
      quantityTotal: 50,
      quantityRemaining: 50,
    })
    const saveObject: any = { inventory: [] }
    const res = await executeMatching(env, {
      newOfferId,
      newCharacterId: myCharId,
      offerType: 'buy',
      itemId: 'feather',
      price: 100,
      quantity: 50,
      saveObject,
    })
    expect(res.totalMatched).toBe(0)
    expect(res.remaining).toBe(50)
  })

  it('two concurrent buys against one resting sell credit only the available stock', async () => {
    const env: any = { DB: new FakeDB() }
    const sellerOfferId = env.DB.seedOffer({
      character_id: 1, offer_type: 'sell', item_id: 'shark', price: 100, quantity_remaining: 10,
    })

    const insertBuy = async (charId: number) => {
      const offerId = await insertOffer(env, {
        characterId: charId,
        offerType: 'buy',
        itemId: 'shark',
        price: 100,
        quantityTotal: 10,
        quantityRemaining: 10,
      })
      const saveObject: any = { inventory: [] }
      const res = await executeMatching(env, {
        newOfferId: offerId,
        newCharacterId: charId,
        offerType: 'buy',
        itemId: 'shark',
        price: 100,
        quantity: 10,
        saveObject,
      })
      return { offerId, res, saveObject }
    }

    // Sequential is fine in JS, but the new conditional UPDATE means
    // even if both buyers "saw" 10 remaining at fetch time, only one
    // succeeds in decrementing the row.
    const buyer1 = await insertBuy(2)
    const buyer2 = await insertBuy(3)

    // Buyer 1 gets the full 10. Buyer 2 finds the row already gone
    // (status: ready-to-collect or DB-side empty) and matches nothing.
    expect(buyer1.res.totalMatched).toBe(10)
    expect(buyer2.res.totalMatched).toBe(0)

    // Seller row was decremented exactly once.
    const sellerRow = env.DB.rows.find((r: any) => r.id === sellerOfferId)
    if (sellerRow) {
      expect(sellerRow.quantity_remaining).toBe(0)
      expect(sellerRow.items_pending).toBe(0)
      expect(sellerRow.coins_pending).toBe(1000)
    }
  })

  it('skips an opposing offer that has already been consumed (OFFER_RACE)', async () => {
    const env: any = { DB: new FakeDB() }
    // Two competing sells from different characters at the same price.
    const stale = env.DB.seedOffer({ character_id: 1, offer_type: 'sell', item_id: 'shark', price: 100, quantity_remaining: 5 })
    const fresh = env.DB.seedOffer({ character_id: 2, offer_type: 'sell', item_id: 'shark', price: 100, quantity_remaining: 10 })

    // Manually drain the stale offer to zero (simulating a concurrent
    // matcher that beat us to it).
    const staleRow = env.DB.rows.find((r: any) => r.id === stale)
    staleRow.quantity_remaining = 0

    const newOfferId = await insertOffer(env, {
      characterId: 3,
      offerType: 'buy',
      itemId: 'shark',
      price: 100,
      quantityTotal: 10,
      quantityRemaining: 10,
    })
    const saveObject: any = { inventory: [] }
    const res = await executeMatching(env, {
      newOfferId,
      newCharacterId: 3,
      offerType: 'buy',
      itemId: 'shark',
      price: 100,
      quantity: 10,
      saveObject,
    })
    // We fall through to the fresh offer and fill 10.
    expect(res.totalMatched).toBe(10)
    expect(res.matches.find(m => m.offerId === fresh)?.quantity).toBe(10)
  })
})
