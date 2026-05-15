import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInActiveMatch } from '../../_lib/pvp.js'
import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { loadCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { toErrorResponse, GameApiError } from '../../_lib/game/errors.js'
import { auditLog } from '../../_lib/game/audit.js'
import { addCoins } from '../../_lib/game/economy.js'
import { canonicalItemId, normalizeSaveItemIds } from '../../_lib/game/inventory.js'
import {
  isTradingPostListable,
  assertSlotAvailable,
  escrowSellItems,
  escrowBuyCoins,
  executeBuyMatching,
  executeSellMatching,
  insertOffer,
  MAX_ACTIVE_OFFERS_PER_CHARACTER,
} from '../../_lib/game/tradingPost.js'

// POST /api/trading-post/list  { offer_type, item_id, price, quantity }
//
// Lists a buy or sell offer for an order-book-restricted item (boss/raid
// unique or clue reward). Immediate-execute general store items still use
// /api/purchase. Matching runs synchronously: matched portion settles, the
// remainder is parked on the order book.
export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  try {
    const body = await request.json()
    const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
    const offerType = body?.offer_type
    const rawItemId = body?.item_id
    const price = Math.floor(Number(body?.price) || 0)
    const quantity = Math.floor(Number(body?.quantity) || 0)
    if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)
    if (offerType !== 'buy' && offerType !== 'sell') return json({ error: 'Invalid offer_type', code: 'INVALID_OFFER_TYPE' }, 400)
    if (!rawItemId || typeof rawItemId !== 'string') return json({ error: 'Invalid item_id', code: 'INVALID_ITEM_ID' }, 400)
    if (price < 1) return json({ error: 'Price must be >= 1', code: 'INVALID_PRICE' }, 400)
    if (quantity < 1) return json({ error: 'Quantity must be >= 1', code: 'INVALID_QUANTITY' }, 400)

    const lock = await assertNotInActiveMatch(env, characterId)
    if (lock) return lock

    // Items.json keys some entries by a legacy id but exposes a canonical id
    // via `item.id`. Resolve here so the DB only ever sees one identifier
    // per item -- otherwise sellers (slot.itemId) and buyers (search result
    // id) write different rows and never match.
    const itemId = canonicalItemId(itemsData, rawItemId)
    const item = itemsData[itemId] || itemsData[rawItemId]
    if (!item) return json({ error: 'Item not found', code: 'ITEM_NOT_FOUND' }, 404)
    if (!isTradingPostListable(item)) {
      return json({
        error: 'This item cannot be listed on the trading post.',
        code: 'NOT_LISTABLE',
      }, 400)
    }

    const { row, saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, auth.identity.id)
    if (row.is_ironman) {
      return json({ error: 'Ironman characters cannot use the trading post.', code: 'IRONMAN_RESTRICTED' }, 403)
    }

    // Rewrite legacy ids in the save itself so escrow/match work uniformly,
    // and so the persisted save phases out the legacy keys on next write.
    normalizeSaveItemIds(saveObject, itemsData)

    await assertSlotAvailable(env, characterId)

    const stackable = Boolean(item.stackable)
    let totalSpent = 0
    let totalEarned = 0
    let totalReceived = 0
    let totalSold = 0
    let remaining = quantity

    if (offerType === 'buy') {
      // Escrow up to maxPrice * quantity. Unused coins are refunded after
      // matching completes, leaving exactly `remaining * price` reserved for
      // the parked offer.
      escrowBuyCoins(saveObject, price * quantity)
      const res = await executeBuyMatching(env, {
        buyerCharacterId: characterId,
        buyerSave: saveObject,
        itemId,
        maxPrice: price,
        quantity,
        stackable,
      })
      remaining = res.remaining
      totalSpent = res.totalSpent
      totalReceived = res.totalReceived
      // Refund the price-improvement (cap*matched - actuallySpent).
      const refund = price * totalReceived - totalSpent
      if (refund > 0) addCoins(saveObject, refund)
    } else {
      // Escrow items first; matching converts them to coins as fills happen.
      escrowSellItems(saveObject, itemId, quantity)
      const res = await executeSellMatching(env, {
        sellerCharacterId: characterId,
        sellerSave: saveObject,
        itemId,
        minPrice: price,
        quantity,
        stackable,
      })
      remaining = res.remaining
      totalEarned = res.totalEarned
      totalSold = res.totalSold
    }

    let offerId = null
    if (remaining > 0) {
      offerId = await insertOffer(env, {
        characterId,
        offerType,
        itemId,
        price,
        quantityTotal: quantity,
        quantityRemaining: remaining,
      })
    }

    const write = await writeSave(env, characterId, saveObject, saveRevision)

    auditLog('trading_post_list', {
      characterId,
      offerType,
      itemId,
      price,
      quantity,
      remaining,
      totalSpent,
      totalEarned,
      totalReceived,
      totalSold,
      offerId,
    })

    return json({
      ok: true,
      offer_id: offerId,
      remaining,
      matched_quantity: offerType === 'buy' ? totalReceived : totalSold,
      total_spent: totalSpent,
      total_earned: totalEarned,
      save_revision: write.saveRevision,
      updatedAt: write.updatedAt,
      max_slots: MAX_ACTIVE_OFFERS_PER_CHARACTER,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
