import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInActiveMatch } from '../../_lib/pvp.js'
import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { loadCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import { auditLog } from '../../_lib/game/audit.js'
import { canonicalItemId, normalizeSaveItemIds } from '../../_lib/game/inventory.js'
import {
  isTradingPostListable,
  isOrderBookItem,
  autoFillSellAtShopValue,
  assertSlotAvailable,
  escrowSellItems,
  escrowBuyCoins,
  executeMatching,
  insertOffer,
  MAX_ACTIVE_OFFERS_PER_CHARACTER,
} from '../../_lib/game/tradingPost.js'

// POST /api/trading-post/list  { offer_type, item_id, price, quantity }
//
// Reserves an offer slot, escrows the requisite items/coins from the
// player's save, inserts the offer row, then runs matching against the
// book. Filled portions appear on both sides as items_pending /
// coins_pending awaiting manual /collect. Unfilled portions stay parked
// as 'active'.
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

    const itemId = canonicalItemId(itemsData, rawItemId)
    const item = itemsData[itemId] || itemsData[rawItemId]
    if (!item) return json({ error: 'Item not found', code: 'ITEM_NOT_FOUND' }, 404)
    if (!isTradingPostListable(item)) {
      return json({ error: 'This item cannot be listed on the trading post.', code: 'NOT_LISTABLE' }, 400)
    }

    const { row, saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, auth.identity.id)
    if (row.is_ironman) {
      return json({ error: 'Ironman characters cannot use the trading post.', code: 'IRONMAN_RESTRICTED' }, 403)
    }

    normalizeSaveItemIds(saveObject, itemsData)

    // Non-order-book sells auto-fill at the item's shopValue. The game is the
    // buyer; the listing never touches the order book, so no slot is consumed
    // and no DB row is inserted. The client-supplied price is intentionally
    // ignored to prevent a "list at extreme price → game buys" gold dupe.
    if (offerType === 'sell' && !isOrderBookItem(item)) {
      const { unit, totalPayout } = autoFillSellAtShopValue(saveObject, item, itemId, quantity)
      const write = await writeSave(env, characterId, saveObject, saveRevision)
      await auditLog(env, 'trading_post_list_autofill', { characterId, identityId: auth.identity.id, itemId, quantity, unit, totalPayout }, { swallow: true })
      return json({
        ok: true,
        offer_id: null,
        remaining: 0,
        matched_quantity: quantity,
        total_spent: 0,
        total_earned: totalPayout,
        price_improvement_refund: 0,
        save_revision: write.saveRevision,
        updatedAt: write.updatedAt,
        max_slots: MAX_ACTIVE_OFFERS_PER_CHARACTER,
      })
    }

    await assertSlotAvailable(env, characterId)

    // Escrow first (modifies saveObject in-memory only). If this throws, the
    // listing has not yet touched the DB.
    if (offerType === 'buy') {
      escrowBuyCoins(saveObject, price * quantity)
    } else {
      escrowSellItems(saveObject, itemId, quantity)
    }

    // Insert the new offer at full quantity. Matching mutates both sides'
    // rows directly so the row needs to exist before we run it.
    const offerId = await insertOffer(env, {
      characterId,
      offerType,
      itemId,
      price,
      quantityTotal: quantity,
      quantityRemaining: quantity,
    })
    if (!offerId) {
      return json({ error: 'Failed to create offer', code: 'INSERT_FAILED' }, 500)
    }

    // Run matching. recordFill credits items_pending to the buyer offer and
    // coins_pending to the seller offer; price improvement (if any) is
    // refunded inline to the saveObject.
    const matchRes = await executeMatching(env, {
      newOfferId: offerId,
      newCharacterId: characterId,
      offerType,
      itemId,
      price,
      quantity,
      saveObject,
    })

    const write = await writeSave(env, characterId, saveObject, saveRevision)

    await auditLog(env, 'trading_post_list', {
      characterId,
      identityId: auth.identity.id,
      offerType,
      itemId,
      price,
      quantity,
      offerId,
      matched: matchRes.totalMatched,
      remaining: matchRes.remaining,
      totalSpent: matchRes.totalSpent,
      totalEarned: matchRes.totalEarned,
      priceImprovementRefund: matchRes.priceImprovementRefund,
    }, { swallow: true })

    return json({
      ok: true,
      offer_id: offerId,
      remaining: matchRes.remaining,
      matched_quantity: matchRes.totalMatched,
      total_spent: matchRes.totalSpent,
      total_earned: matchRes.totalEarned,
      price_improvement_refund: matchRes.priceImprovementRefund,
      save_revision: write.saveRevision,
      updatedAt: write.updatedAt,
      max_slots: MAX_ACTIVE_OFFERS_PER_CHARACTER,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
