import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { GameApiError } from './errors.js'
import { getInventory, addItemToInventory, addItemToBank, removeItemFromInventory, canonicalItemId } from './inventory.js'
import { subtractCoins, addCoins } from './economy.js'

// Alias map keyed by every id form (canonical AND legacy) -> the full set
// of synonymous ids. Used by the matcher so a buy can find sells stored
// under any synonym, regardless of which form the buyer/seller picked.
// This protects against older saves writing legacy keys while newer code
// writes the canonical id.
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
  READY_TO_COLLECT: 'ready_to_collect',
  COMPLETED: 'completed',
}

// Items eligible for the player-to-player order book. Everything else uses
// the legacy /api/purchase auto-execute path against the static shop.
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

// Deliver `quantity` items to the character's inventory; spill to bank when
// the inventory is full. Stackable items always coalesce; non-stackables
// follow OSRS GE noted-delivery for multi-quantity fills.
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
  // Non-stackable: deliver as noted stack when qty > 1 (matches /api/purchase).
  if (quantity > 1) {
    const hasNoted = inv.some((s) => s?.itemId === itemId && s.noted)
    if (hasNoted || inv.length < 28) {
      addItemToInventory(saveObject, itemId, quantity, { stackable: true, noted: true })
    } else {
      addItemToBank(saveObject, itemId, quantity)
    }
    return
  }
  // qty === 1 non-stackable
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
    `SELECT COUNT(*) AS n FROM trading_post_offers WHERE character_id = ? AND status = 'active'`,
  ).bind(characterId).first()
  return Number(row?.n) || 0
}

// Selects opposing offers ordered by best price first, then oldest first.
// For a buy, opposing sells with price <= maxPrice, ordered price ASC.
// For a sell, opposing buys with price >= minPrice, ordered price DESC.
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

// Pick the status to apply to an offer after a fill updates its remaining
// quantity. Fully filled offers go to 'ready_to_collect' so the owner can
// pick up coins/items via /api/trading-post/collect; the slot frees up
// immediately. If, for some reason, an offer reaches remaining=0 with no
// pending payouts (e.g. a self-trade where everything was delivered
// inline), skip the collect step and mark it directly 'completed'.
async function applyOpposingOfferFill(env, offerId, newRemaining) {
  const now = nowMs()
  if (newRemaining > 0) {
    await env.DB.prepare(
      `UPDATE trading_post_offers
       SET quantity_remaining = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(newRemaining, now, offerId).run()
    return
  }
  const row = await env.DB.prepare(
    `SELECT coins_pending, items_pending FROM trading_post_offers WHERE id = ?`,
  ).bind(offerId).first()
  const hasPending = Number(row?.coins_pending) > 0 || Number(row?.items_pending) > 0
  const nextStatus = hasPending ? OFFER_STATUS.READY_TO_COLLECT : OFFER_STATUS.COMPLETED
  await env.DB.prepare(
    `UPDATE trading_post_offers
     SET quantity_remaining = 0, status = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(nextStatus, now, offerId).run()
}

// Settle the buyer side of a match. Items are delivered to the buyer's save
// immediately. If the counterparty is offline (different character_id), their
// coins are queued as coins_pending on their own offer for next-load delivery.
async function settleBuyerSide(env, { buyerCharacterId, buyerSave, itemId, quantity, stackable }) {
  deliverItems(buyerSave, itemId, quantity, { stackable })
}

// Add coins payable to the seller. Online-self path delivers to the active
// save; otherwise stash on the seller's offer row for them to collect next
// time they load /my-offers.
async function settleSellerSide(env, { sellerOfferId, sellerCharacterId, buyerCharacterId, buyerSave, gold }) {
  if (sellerCharacterId == null) {
    // Orphan / house listing -- coins go to the void (20% sink baked in at
    // instant-sell time; the buyer's 100% payment is the sink amount).
    return
  }
  if (sellerCharacterId === buyerCharacterId) {
    // Self-trade -- return coins straight to the active save.
    deliverCoins(buyerSave, gold)
    return
  }
  const now = nowMs()
  await env.DB.prepare(
    `UPDATE trading_post_offers
     SET coins_pending = coins_pending + ?, updated_at = ?
     WHERE id = ?`,
  ).bind(gold, now, sellerOfferId).run()
}

// Same as settleSellerSide but for buyer-side counterparties (i.e. when this
// character is the seller). The opposing buyer's items go into items_pending
// on their offer.
async function settleBuyerCounterparty(env, { buyerOfferId, buyerCharacterId, sellerCharacterId, sellerSave, quantity, itemId, stackable }) {
  if (buyerCharacterId === sellerCharacterId) {
    deliverItems(sellerSave, itemId, quantity, { stackable })
    return
  }
  const now = nowMs()
  await env.DB.prepare(
    `UPDATE trading_post_offers
     SET items_pending = items_pending + ?, updated_at = ?
     WHERE id = ?`,
  ).bind(quantity, now, buyerOfferId).run()
}

// Core matcher for an incoming BUY from `buyerCharacterId`. Walks opposing
// sells from cheapest to most expensive, executing partial fills. Coins for
// the trade are deducted from the buyer's save up to the actual matched
// amount; the unmatched remainder is what gets put on the order book by the
// caller, so the caller passes us an already-reserved budget.
export async function executeBuyMatching(env, { buyerCharacterId, buyerSave, itemId, maxPrice, quantity, stackable }) {
  let remaining = quantity
  let totalSpent = 0
  let totalReceived = 0
  const matches = []
  const opposing = await fetchMatchableOffers(env, { itemId, side: 'buy', limitPrice: maxPrice })
  for (const sell of opposing) {
    if (remaining <= 0) break
    const tradeQty = Math.min(remaining, Number(sell.quantity_remaining) || 0)
    if (tradeQty <= 0) continue
    // Buyer pays the seller's listed price (better for buyer than their cap).
    const tradePrice = Number(sell.price)
    const tradeGold = tradePrice * tradeQty
    await settleBuyerSide(env, { buyerCharacterId, buyerSave, itemId, quantity: tradeQty, stackable })
    await settleSellerSide(env, {
      sellerOfferId: sell.id,
      sellerCharacterId: sell.character_id,
      buyerCharacterId,
      buyerSave,
      gold: tradeGold,
    })
    const newRemaining = (Number(sell.quantity_remaining) || 0) - tradeQty
    await applyOpposingOfferFill(env, sell.id, newRemaining)
    remaining -= tradeQty
    totalSpent += tradeGold
    totalReceived += tradeQty
    matches.push({ offerId: sell.id, price: tradePrice, quantity: tradeQty })
  }
  return { remaining, totalSpent, totalReceived, matches }
}

// Mirror of executeBuyMatching for an incoming SELL.
export async function executeSellMatching(env, { sellerCharacterId, sellerSave, itemId, minPrice, quantity, stackable }) {
  let remaining = quantity
  let totalEarned = 0
  let totalSold = 0
  const matches = []
  const opposing = await fetchMatchableOffers(env, { itemId, side: 'sell', limitPrice: minPrice })
  for (const buy of opposing) {
    if (remaining <= 0) break
    const tradeQty = Math.min(remaining, Number(buy.quantity_remaining) || 0)
    if (tradeQty <= 0) continue
    // Seller receives the buyer's listed price (better for seller).
    const tradePrice = Number(buy.price)
    const tradeGold = tradePrice * tradeQty
    // Coins to the seller -- self path delivers to inv, offline path is
    // unreachable since seller is the active save here.
    deliverCoins(sellerSave, tradeGold)
    await settleBuyerCounterparty(env, {
      buyerOfferId: buy.id,
      buyerCharacterId: buy.character_id,
      sellerCharacterId,
      sellerSave,
      quantity: tradeQty,
      itemId,
      stackable,
    })
    const newRemaining = (Number(buy.quantity_remaining) || 0) - tradeQty
    await applyOpposingOfferFill(env, buy.id, newRemaining)
    remaining -= tradeQty
    totalEarned += tradeGold
    totalSold += tradeQty
    matches.push({ offerId: buy.id, price: tradePrice, quantity: tradeQty })
  }
  return { remaining, totalEarned, totalSold, matches }
}

export async function insertOffer(env, { characterId, offerType, itemId, price, quantityTotal, quantityRemaining }) {
  const now = nowMs()
  // Only call this when there is leftover quantity to park on the book.
  // Fully-filled offers never get an inserted row; their payouts are settled
  // inline on the matching path.
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
  // Hide collected ('completed') and cancelled-and-deleted rows from "my
  // offers" -- the only states the player still needs to see are open
  // listings and fills awaiting collection.
  const { results } = await env.DB.prepare(
    `SELECT * FROM trading_post_offers
     WHERE character_id = ? AND status IN ('active', 'ready_to_collect')
     ORDER BY created_at DESC`,
  ).bind(characterId).all()
  return results || []
}

// Deliver any pending coins/items on a single offer into the save, then
// settle the offer's status:
//   * fully filled (remaining = 0) + payouts emptied -> 'completed' (hidden)
//   * still on the book (remaining > 0) -> stays 'active', pending cleared.
// Mutates saveObject; caller must writeSave.
export async function collectOffer(env, { offer, saveObject, itemsLookup }) {
  const coinsPending = Math.floor(Number(offer.coins_pending) || 0)
  const itemsPending = Math.floor(Number(offer.items_pending) || 0)
  if (coinsPending <= 0 && itemsPending <= 0
      && offer.status !== OFFER_STATUS.READY_TO_COLLECT) {
    throw new GameApiError('NOTHING_TO_COLLECT', 'No coins or items to collect on this offer.', 400)
  }
  if (coinsPending > 0) deliverCoins(saveObject, coinsPending)
  if (itemsPending > 0) {
    const canonId = canonicalItemId(itemsLookup, offer.item_id)
    const item = itemsLookup?.[canonId] || itemsLookup?.[offer.item_id]
    deliverItems(saveObject, canonId, itemsPending, { stackable: Boolean(item?.stackable) })
  }
  const remaining = Math.floor(Number(offer.quantity_remaining) || 0)
  const now = nowMs()
  if (remaining <= 0) {
    await env.DB.prepare(
      `UPDATE trading_post_offers
       SET coins_pending = 0, items_pending = 0, status = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(OFFER_STATUS.COMPLETED, now, offer.id).run()
  } else {
    await env.DB.prepare(
      `UPDATE trading_post_offers
       SET coins_pending = 0, items_pending = 0, updated_at = ?
       WHERE id = ?`,
    ).bind(now, offer.id).run()
  }
  return { coinsCollected: coinsPending, itemsCollected: itemsPending }
}

// Returns the escrowed value the player should recover when cancelling.
// For a buy offer that's only partially filled, the player gets the unspent
// coins (quantity_remaining * price). For a sell offer they get the unsold
// items back. Items_pending / coins_pending from earlier partial fills are
// flushed in the same op. The offer row is then deleted -- there's no value
// in keeping cancelled history.
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
    if (coinsPending > 0) deliverCoins(saveObject, coinsPending) // shouldn't happen for buys but safe
  } else {
    if (remaining > 0) deliverItems(saveObject, canonId, remaining, { stackable })
    if (coinsPending > 0) deliverCoins(saveObject, coinsPending)
    if (itemsPending > 0) deliverItems(saveObject, canonId, itemsPending, { stackable })
  }
  await env.DB.prepare(
    `DELETE FROM trading_post_offers WHERE id = ?`,
  ).bind(offer.id).run()
}

// Convert a remaining sell offer into orphan house stock at 80% payout. The
// row is detached from the character (character_id = NULL) and stays
// purchasable at the original listed price; the spread is the gold sink.
export async function instantSellOffer(env, { offer, saveObject, itemsLookup }) {
  const remaining = Number(offer.quantity_remaining) || 0
  if (remaining <= 0) throw new GameApiError('NO_REMAINING_QTY', 'Offer has no remaining quantity to instant-sell', 400)
  if (offer.offer_type !== 'sell') throw new GameApiError('NOT_SELL_OFFER', 'Only sell offers can be instant-sold', 400)
  const payout = Math.floor(remaining * Number(offer.price) * INSTANT_SELL_PAYOUT_FRACTION)
  deliverCoins(saveObject, payout)
  // Also flush any already-pending coins from earlier fills.
  const coinsPending = Number(offer.coins_pending) || 0
  if (coinsPending > 0) deliverCoins(saveObject, coinsPending)
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

// Snapshot of best bid/ask for a single item -- used for the search detail
// pane so players can see current market spread without exposing other
// players' offer ids.
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
