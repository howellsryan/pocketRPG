import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInCoopSession } from '../../_lib/game/coopBoss.js'
import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { loadCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import { auditLog } from '../../_lib/game/audit.js'
import { canonicalItemId, normalizeSaveItemIds } from '../../_lib/game/inventory.js'
import { addCoins } from '../../_lib/game/economy.js'
import { addItemToBank } from '../../_lib/game/inventory.js'
import {
  isTradingPostListable,
  isOrderBookItem,
  autoFillSellAtShopValue,
  assertSlotAvailable,
  escrowSellItems,
  escrowBuyCoins,
  executeMatching,
  insertOffer,
  normalizeSellSource,
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
    // Sells can pull from the bank as well as the inventory. Buys ignore this.
    const source = normalizeSellSource(body?.source)
    if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)
    if (offerType !== 'buy' && offerType !== 'sell') return json({ error: 'Invalid offer_type', code: 'INVALID_OFFER_TYPE' }, 400)
    if (!rawItemId || typeof rawItemId !== 'string') return json({ error: 'Invalid item_id', code: 'INVALID_ITEM_ID' }, 400)
    if (price < 1) return json({ error: 'Price must be >= 1', code: 'INVALID_PRICE' }, 400)
    if (quantity < 1) return json({ error: 'Quantity must be >= 1', code: 'INVALID_QUANTITY' }, 400)

    // A co-op boss fight owns this save: the room is mutating the pack tick by
    // tick and replays its snapshot on write-back.
    const coopLock = await assertNotInCoopSession(env, characterId)
    if (coopLock) return coopLock

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

    // Non-order-book sells auto-fill at the item's shopValue — General Store
    // stock and quest-unlock items reach this branch (the store/quest shop
    // keeps buying/selling at fixed prices). The game is the buyer; the
    // listing never touches the order book, so no slot is consumed and no DB
    // row is inserted. The client-supplied price is intentionally ignored to
    // prevent a "list at extreme price → game buys" gold dupe.
    if (offerType === 'sell' && !isOrderBookItem(item)) {
      const { unit, totalPayout } = autoFillSellAtShopValue(saveObject, item, itemId, quantity, source)
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

    // Buy side of a non-order-book item: the General Store / quest shop sells
    // these at a fixed price in unlimited quantity, so a resting buy offer
    // could never be filled by a rational seller. Rejecting it keeps the
    // order book free of General Store and quest items entirely.
    if (!isOrderBookItem(item)) {
      return json({ error: 'This item is sold by the General Store — buy it there instead.', code: 'GENERAL_STORE_ITEM' }, 400)
    }

    await assertSlotAvailable(env, characterId)

    // Escrow in memory. Then commit the escrow via writeSave BEFORE any
    // DB-side mutation (offer insert + matching). Pre-step-2 the offer
    // rows were written first and writeSave came last — if writeSave hit
    // a save_revision conflict the offer existed but the player was
    // never debited, so they could collect items_pending without paying.
    if (offerType === 'buy') {
      escrowBuyCoins(saveObject, price * quantity)
    } else {
      escrowSellItems(saveObject, itemId, quantity, source)
    }
    const escrowWrite = await writeSave(env, characterId, saveObject, saveRevision)
    const postEscrowRevision = escrowWrite.saveRevision

    // Compensating refund: if anything after the escrow commit fails
    // (offer insert, matching IO), undo the in-memory escrow and write
    // again with the post-escrow revision. We can't roll back the DB
    // revision bump but we can restore the player's coins/items so they
    // are not silently debited.
    async function refundEscrow(reason) {
      try {
        if (offerType === 'buy') {
          addCoins(saveObject, price * quantity)
        } else {
          // Sell side: the item may be a non-stackable batch the inventory
          // can't easily reabsorb mid-flow. Bank it so the refund is always
          // representable, matching the bank-overflow convention elsewhere.
          addItemToBank(saveObject, itemId, quantity)
        }
        await writeSave(env, characterId, saveObject, postEscrowRevision)
        await auditLog(env, 'trading_post_list.compensating_refund', {
          characterId, identityId: auth.identity.id, offerType, itemId, price, quantity, reason,
        }, { swallow: true })
      } catch (refundErr) {
        // Best-effort. If the refund write also fails, log the situation
        // for manual reconciliation — the audit row is the support trail.
        await auditLog(env, 'trading_post_list.compensating_refund_failed', {
          characterId, identityId: auth.identity.id, offerType, itemId, price, quantity, reason, refundError: refundErr?.message || String(refundErr),
        }, { swallow: true })
      }
    }

    let offerId, matchRes
    try {
      offerId = await insertOffer(env, {
        characterId,
        offerType,
        itemId,
        price,
        quantityTotal: quantity,
        quantityRemaining: quantity,
      })
      if (!offerId) {
        await refundEscrow('insert_failed')
        return json({ error: 'Failed to create offer', code: 'INSERT_FAILED' }, 500)
      }
      matchRes = await executeMatching(env, {
        newOfferId: offerId,
        newCharacterId: characterId,
        offerType,
        itemId,
        price,
        quantity,
        saveObject,
      })
    } catch (err) {
      await refundEscrow(err?.code || err?.message || 'matching_failed')
      throw err
    }

    // Matching may have credited the buyer's price-improvement refund
    // inline to saveObject. Persist that with a second writeSave using
    // the revision bump from the escrow commit.
    const write = await writeSave(env, characterId, saveObject, postEscrowRevision)

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
