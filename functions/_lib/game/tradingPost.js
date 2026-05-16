import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { GameApiError } from './errors.js'
import { getInventory, addItemToInventory, addItemToBank, removeItemFromInventory, canonicalItemId } from './inventory.js'
import { subtractCoins, addCoins } from './economy.js'

// Alias map keyed by every id form (canonical AND legacy) -> the full set
// of synonymous ids. Used by the matcher so a buy can find sells stored
// under any synonym, regardless of which form the buyer/seller picked.
const ALIAS_GROUPS = (() => {
  const groups = new Map()
  for (const [key, item] of Object.entries(itemsData)) {
    const canon = (item && typeof item.id === 'string' && item.id) ? item.id : key
    if (canon === key) continue
    const group = new Set([key, canon])
    groups.set(key, group)
    groups.set(canon, group)
  }
  return groups
})()

function itemIdMatchSet(itemId) {
  const set = ALIAS_GROUPS.get(itemId)
  if (set) return [...set]
  return [itemId]
}

export const MAX_ACTIVE_OFFERS_PER_CHARACTER = 8
export const INSTANT_SELL_PAYOUT_FRACTION = 0.8

export const OFFER_STATUS = {
  ACTIVE: 'active',
}

export function isOrderBookItem(item) {
  if (!item) return false
  return Boolean(item.isBossUnique || item.isClueReward || item.isRaidUnique)
}

export function isTradingPostListable(item) {
  if (!item) return false
  if (item.isUntradeable) return false
  if (isOrderBookItem(item)) return true
  const shopValue = Math.floor(Number(item?.shopValue) || 0)
  return shopValue > 0
}

// Push delivered items into the save -- inventory first, bank fallback.
// Stackable items always coalesce; multi-quantity non-stackables become a
// noted stack to match the /api/purchase delivery shape.
function deliverItems(saveObject, itemId, quantity, { stackable }) {
  if (quantity <= 0) return
  const inv = getInventory(saveObject)
  if (stackable) {
    const hasStack = inv.some((s) => s?.itemId === itemId && !s.noted)
    if (hasStack || inv.length < 28) {
      addItemToInventory(saveObject, itemId, quantity, { stackable: true, noted: false })
    } else {
      addItemToBank(saveObject, itemId, quantity)
    }
    return
  }
  if (quantity > 1) {
    const hasNoted = inv.some((s) => s?.itemId === itemId && s.noted)
    if (hasNoted || inv.length < 28) {
      addItemToInventory(saveObject, itemId, quantity, { stackable: true, noted: true })
    } else {
      addItemToBank(saveObject, itemId, quantity)
    }
    return
  }
  if (inv.length < 28) {
    addItemToInventory(saveObject, itemId, 1, { stackable: false, noted: false })
  } else {
    addItemToBank(saveObject, itemId, 1)
  }
}

function deliverCoins(saveObject, amount) {
  if (amount <= 0) return
  addCoins(saveObject, amount)
}

function nowMs() {
  return Date.now()
}

async function countActiveOffers(env, characterId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM trading_post_offers
     WHERE character_id = ? AND status = 'active'
       AND NOT (quantity_remaining = 0 AND (coins_pending > 0 OR items_pending > 0))`,
  ).bind(characterId).first()
  return Number(row?.n) || 0
}

// Find every existing offer that the incoming offer could match against.
// For an incoming buy: opposing sells with price <= maxPrice, cheapest first.
// For an incoming sell: opposing buys with price >= minPrice, dearest first.
async function fetchMatchableOffers(env, { itemId, side, limitPrice }) {
  const ids = itemIdMatchSet(itemId)
  const placeholders = ids.map(() => '?').join(',')
  if (side === 'buy') {
    const { results } = await env.DB.prepare(
      `SELECT * FROM trading_post_offers
       WHERE item_id IN (${placeholders}) AND offer_type = 'sell' AND status = 'active' AND price <= ?
       ORDER BY price ASC, created_at ASC`,
    ).bind(...ids, limitPrice).all()
    return results || []
  }
  const { results } = await env.DB.prepare(
    `SELECT * FROM trading_post_offers
     WHERE item_id IN (${placeholders}) AND offer_type = 'buy' AND status = 'active' AND price >= ?
     ORDER BY price DESC, created_at ASC`,
  ).bind(...ids, limitPrice).all()
  return results || []
}

// Record one match-unit on the two sides' offer rows. The buyer's offer
// gets items credited to items_pending; the seller's offer gets coins
// credited to coins_pending (unless it's orphan house stock with no
// owner -- those coins are the gold sink). Both rows'
// quantity_remaining gets decremented to its caller-computed value.
async function recordFill(env, { buyerOfferId, sellerOfferId, tradeQty, tradePrice, buyerOfferRemaining, sellerOfferRemaining, sellerIsOrphan }) {
  const now = nowMs()
  const tradeGold = tradePrice * tradeQty
  if (sellerIsOrphan) {
    // No owner to pay -- skip the credit. Decrement quantity_remaining only.
    await env.DB.prepare(
      `UPDATE trading_post_offers
       SET quantity_remaining = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(sellerOfferRemaining, now, sellerOfferId).run()
  } else {
    await env.DB.prepare(
      `UPDATE trading_post_offers
       SET coins_pending = coins_pending + ?, quantity_remaining = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(tradeGold, sellerOfferRemaining, now, sellerOfferId).run()
  }
  await env.DB.prepare(
    `UPDATE trading_post_offers
     SET items_pending = items_pending + ?, coins_pending = coins_pending + ?, quantity_remaining = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(tradeQty, tradeGold, buyerOfferRemaining, now, buyerOfferId).run()
}

// Re-read an offer after fills.
//   * remaining > 0 -> stays 'active'.
//   * remaining = 0, no pending -> row is removed entirely (nothing to do
//     with it; happens only on self-trades).
//   * remaining = 0, pending exists -> keep status='active' and rely on
//     (remaining=0,pending>0) as the ready-to-collect signal.
async function finalizeOfferStatus(env, offerId) {
  const row = await env.DB.prepare(
    `SELECT quantity_remaining, coins_pending, items_pending FROM trading_post_offers WHERE id = ?`,
  ).bind(offerId).first()
  if (!row) return
  const remaining = Number(row.quantity_remaining) || 0
  if (remaining > 0) return
  const hasPending = Number(row.coins_pending) > 0 || Number(row.items_pending) > 0
  if (!hasPending) {
    await env.DB.prepare(`DELETE FROM trading_post_offers WHERE id = ?`).bind(offerId).run()
    return
  }
}

// Run matching for a brand-new offer (already inserted with row id
// `newOfferId`). Walks the book and emits one recordFill per match. Trade
// price is always the resting offer's price -- the new offer takes whatever
// improvement the book gives, refunded to the caller's save inline when
// they're the buyer. Returns aggregate stats so the API handler can answer
// the request and emit audit events.
export async function executeMatching(env, { newOfferId, newCharacterId, offerType, itemId, price, quantity, saveObject }) {
  const side = offerType === 'buy' ? 'buy' : 'sell'
  const opposing = await fetchMatchableOffers(env, { itemId, side, limitPrice: price })

  let remaining = quantity
  let totalMatched = 0
  let totalSpent = 0
  let totalEarned = 0
  let priceImprovementRefund = 0
  const matches = []

  for (const opp of opposing) {
    if (remaining <= 0) break
    const oppRemaining = Number(opp.quantity_remaining) || 0
    if (oppRemaining <= 0) continue
    const tradeQty = Math.min(remaining, oppRemaining)
    const oppPrice = Number(opp.price)
    const tradePrice = oppPrice
    const newOfferRemaining = remaining - tradeQty
    const oppNewRemaining = oppRemaining - tradeQty

    if (offerType === 'buy') {
      // New offer is buy, opp is sell. Trade at opp's (cheaper) price.
      await recordFill(env, {
        buyerOfferId: newOfferId,
        sellerOfferId: opp.id,
        tradeQty,
        tradePrice,
        buyerOfferRemaining: newOfferRemaining,
        sellerOfferRemaining: oppNewRemaining,
        sellerIsOrphan: opp.character_id == null,
      })
      const improvement = (price - tradePrice) * tradeQty
      if (improvement > 0) {
        addCoins(saveObject, improvement)
        priceImprovementRefund += improvement
      }
      totalSpent += tradePrice * tradeQty
    } else {
      // New offer is sell, opp is buy. Trade at the resting buy price.
      // A seller accepts the best bid already on the book.
      // The seller side is always the caller here, never orphan.
      await recordFill(env, {
        buyerOfferId: opp.id,
        sellerOfferId: newOfferId,
        tradeQty,
        tradePrice,
        buyerOfferRemaining: oppNewRemaining,
        sellerOfferRemaining: newOfferRemaining,
        sellerIsOrphan: false,
      })
      totalEarned += tradePrice * tradeQty
    }

    await finalizeOfferStatus(env, opp.id)
    remaining -= tradeQty
    totalMatched += tradeQty
    matches.push({ offerId: opp.id, price: tradePrice, quantity: tradeQty })
  }

  await finalizeOfferStatus(env, newOfferId)
  return { remaining, totalMatched, totalSpent, totalEarned, priceImprovementRefund, matches }
}

export async function insertOffer(env, { characterId, offerType, itemId, price, quantityTotal, quantityRemaining }) {
  const now = nowMs()
  const result = await env.DB.prepare(
    `INSERT INTO trading_post_offers
       (character_id, offer_type, item_id, price, quantity_total, quantity_remaining,
        coins_pending, items_pending, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
  ).bind(
    characterId,
    offerType,
    itemId,
    price,
    quantityTotal,
    quantityRemaining,
    OFFER_STATUS.ACTIVE,
    now,
    now,
  ).run()
  return Number(result?.meta?.last_row_id) || null
}

export async function getOwnedOffer(env, offerId, characterId) {
  const row = await env.DB.prepare(
    `SELECT * FROM trading_post_offers WHERE id = ? AND character_id = ?`,
  ).bind(offerId, characterId).first()
  return row || null
}

export async function listOffersForCharacter(env, characterId) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM trading_post_offers
     WHERE character_id = ? AND status IN ('active', 'ready_to_collect')
     ORDER BY created_at DESC`,
  ).bind(characterId).all()
  return results || []
}

// Deliver pending coins/items into the save. If the offer was fully filled
// (remaining = 0), the row is removed once everything's collected;
// otherwise the row stays active with its pending fields zeroed so the
// player can keep waiting on the remainder.
export async function collectOffer(env, { offer, saveObject, itemsLookup }) {
  const coinsPending = Math.floor(Number(offer.coins_pending) || 0)
  const itemsPending = Math.floor(Number(offer.items_pending) || 0)
  if (coinsPending <= 0 && itemsPending <= 0) {
    throw new GameApiError('NOTHING_TO_COLLECT', 'No coins or items to collect on this offer.', 400)
  }
  if (offer.offer_type === 'sell' && coinsPending > 0) deliverCoins(saveObject, coinsPending)
  if (itemsPending > 0) {
    const canonId = canonicalItemId(itemsLookup, offer.item_id)
    const item = itemsLookup?.[canonId] || itemsLookup?.[offer.item_id]
    deliverItems(saveObject, canonId, itemsPending, { stackable: Boolean(item?.stackable) })
  }
  const remaining = Math.floor(Number(offer.quantity_remaining) || 0)
  const now = nowMs()
  if (remaining <= 0) {
    await env.DB.prepare(`DELETE FROM trading_post_offers WHERE id = ?`).bind(offer.id).run()
  } else {
    await env.DB.prepare(
      `UPDATE trading_post_offers
       SET coins_pending = 0, items_pending = 0, updated_at = ?
       WHERE id = ?`,
    ).bind(now, offer.id).run()
  }
  return { coinsCollected: offer.offer_type === 'sell' ? coinsPending : 0, itemsCollected: itemsPending }
}

// Cancel an offer: refund the unmatched escrow + any pending payouts to the
// save, then delete the row entirely. The unmatched escrow is `remaining *
// price` for buys (coins) and `remaining` items for sells.
export async function cancelOffer(env, { offer, saveObject, itemsLookup }) {
  const remaining = Number(offer.quantity_remaining) || 0
  const coinsPending = Number(offer.coins_pending) || 0
  const itemsPending = Number(offer.items_pending) || 0
  const canonId = canonicalItemId(itemsLookup, offer.item_id)
  const item = itemsLookup?.[canonId] || itemsLookup?.[offer.item_id]
  const stackable = Boolean(item?.stackable)
  if (offer.offer_type === 'buy') {
    if (remaining > 0) deliverCoins(saveObject, remaining * Number(offer.price))
    if (itemsPending > 0) deliverItems(saveObject, canonId, itemsPending, { stackable })
    if (offer.offer_type === 'sell' && coinsPending > 0) deliverCoins(saveObject, coinsPending)
  } else {
    if (remaining > 0) deliverItems(saveObject, canonId, remaining, { stackable })
    if (offer.offer_type === 'sell' && coinsPending > 0) deliverCoins(saveObject, coinsPending)
    if (itemsPending > 0) deliverItems(saveObject, canonId, itemsPending, { stackable })
  }
  await env.DB.prepare(`DELETE FROM trading_post_offers WHERE id = ?`).bind(offer.id).run()
}

// Convert a still-active sell offer into orphan house stock at 80% payout.
// The row is detached from the character (character_id = NULL) and stays
// purchasable at the original listed price; the 20% spread is the gold
// sink. Coins/items already pending from earlier partial fills go to the
// seller in the same op.
export async function instantSellOffer(env, { offer, saveObject, itemsLookup }) {
  const remaining = Number(offer.quantity_remaining) || 0
  if (remaining <= 0) throw new GameApiError('NO_REMAINING_QTY', 'Offer has no remaining quantity to instant-sell', 400)
  if (offer.offer_type !== 'sell') throw new GameApiError('NOT_SELL_OFFER', 'Only sell offers can be instant-sold', 400)
  const payout = Math.floor(remaining * Number(offer.price) * INSTANT_SELL_PAYOUT_FRACTION)
  deliverCoins(saveObject, payout)
  const coinsPending = Number(offer.coins_pending) || 0
  if (offer.offer_type === 'sell' && coinsPending > 0) deliverCoins(saveObject, coinsPending)
  const itemsPending = Number(offer.items_pending) || 0
  const canonId = canonicalItemId(itemsLookup, offer.item_id)
  const item = itemsLookup?.[canonId] || itemsLookup?.[offer.item_id]
  if (itemsPending > 0) deliverItems(saveObject, canonId, itemsPending, { stackable: Boolean(item?.stackable) })

  const now = nowMs()
  await env.DB.prepare(
    `UPDATE trading_post_offers
     SET character_id = NULL, coins_pending = 0, items_pending = 0, updated_at = ?
     WHERE id = ?`,
  ).bind(now, offer.id).run()
  return payout
}

// Snapshot of best bid/ask -- used by the search detail pane so players see
// market spread without exposing other players' offer ids.
export async function getMarketSummary(env, itemId) {
  const ids = itemIdMatchSet(itemId)
  const placeholders = ids.map(() => '?').join(',')
  const bestSell = await env.DB.prepare(
    `SELECT price, SUM(quantity_remaining) AS qty
     FROM trading_post_offers
     WHERE item_id IN (${placeholders}) AND offer_type = 'sell' AND status = 'active'
     GROUP BY price
     ORDER BY price ASC
     LIMIT 1`,
  ).bind(...ids).first()
  const bestBuy = await env.DB.prepare(
    `SELECT price, SUM(quantity_remaining) AS qty
     FROM trading_post_offers
     WHERE item_id IN (${placeholders}) AND offer_type = 'buy' AND status = 'active'
     GROUP BY price
     ORDER BY price DESC
     LIMIT 1`,
  ).bind(...ids).first()
  const totalStock = await env.DB.prepare(
    `SELECT COALESCE(SUM(quantity_remaining), 0) AS qty
     FROM trading_post_offers
     WHERE item_id IN (${placeholders}) AND offer_type = 'sell' AND status = 'active'`,
  ).bind(...ids).first()
  return {
    bestSell: bestSell ? { price: Number(bestSell.price), quantity: Number(bestSell.qty) } : null,
    bestBuy: bestBuy ? { price: Number(bestBuy.price), quantity: Number(bestBuy.qty) } : null,
    totalListedQuantity: Number(totalStock?.qty) || 0,
  }
}

export async function assertSlotAvailable(env, characterId) {
  const active = await countActiveOffers(env, characterId)
  if (active >= MAX_ACTIVE_OFFERS_PER_CHARACTER) {
    throw new GameApiError(
      'TRADING_POST_SLOTS_FULL',
      `You already have ${MAX_ACTIVE_OFFERS_PER_CHARACTER} active offers. Cancel one before placing another.`,
      409,
    )
  }
}

export function escrowSellItems(saveObject, itemId, quantity) {
  removeItemFromInventory(saveObject, itemId, quantity)
}

export function escrowBuyCoins(saveObject, totalCoins) {
  subtractCoins(saveObject, totalCoins)
}

// Settle a non-order-book sell instantly at the item's shopValue. The game is
// the buyer, so no DB row is created and no slot is consumed; items leave the
// inventory and coins land in the save directly. Returns the unit price and
// total payout so the caller can audit and respond.
export function autoFillSellAtShopValue(saveObject, item, itemId, quantity) {
  if (isOrderBookItem(item)) {
    throw new GameApiError('ORDER_BOOK_ITEM', 'Order book items cannot auto-fill at shopValue.', 400)
  }
  const unit = Math.floor(Number(item?.shopValue) || 0)
  if (unit <= 0) {
    throw new GameApiError('NO_VALUE', 'This item has no shop value.', 400)
  }
  removeItemFromInventory(saveObject, itemId, quantity)
  const totalPayout = unit * quantity
  addCoins(saveObject, totalPayout)
  return { unit, totalPayout }
}
