import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInCoopSession } from '../../_lib/game/coopBoss.js'
import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { loadCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import { auditLog } from '../../_lib/game/audit.js'
import { isOrderBookItem, normalizeSellSource } from '../../_lib/game/tradingPost.js'
import { getIronmanShopValue } from '../../_lib/game/itemValue.js'
import { removeItemFromSource, canonicalItemId, normalizeSaveItemIds } from '../../_lib/game/inventory.js'
import { addCoins } from '../../_lib/game/economy.js'

// POST /api/trading-post/sell-immediate  { item_id, quantity }
//
// Immediate-execute sell path for anything NOT on the order book — General
// Store stock, quest-unlock items and untradeables with a shop value (the
// untradeable item sink). Settles at the item's static
// shopValue; player gets coins, items leave their inventory. Every other
// tradeable item must be listed via /api/trading-post/list (quick exit:
// instant-sell the listing at 80%).
export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  try {
    const body = await request.json()
    const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
    const rawItemId = body?.item_id
    const quantity = Math.floor(Number(body?.quantity) || 0)
    const source = normalizeSellSource(body?.source)
    if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)
    if (!rawItemId || typeof rawItemId !== 'string') return json({ error: 'Invalid item_id', code: 'INVALID_ITEM_ID' }, 400)
    if (quantity < 1) return json({ error: 'Quantity must be >= 1', code: 'INVALID_QUANTITY' }, 400)

    // A co-op boss fight owns this save: the room is mutating the pack tick by
    // tick and replays its snapshot on write-back.
    const coopLock = await assertNotInCoopSession(env, characterId)
    if (coopLock) return coopLock

    const itemId = canonicalItemId(itemsData, rawItemId)
    const item = itemsData[itemId] || itemsData[rawItemId]
    if (!item) return json({ error: 'Item not found', code: 'ITEM_NOT_FOUND' }, 404)

    const { row, saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, auth.identity.id)
    const isIronman = !!row?.is_ironman

    // Order-book items (tradeable goods, plus boss/raid/clue uniques) normally
    // have to be listed on the player order book. Ironmen can't touch the order
    // book at all, so for them this immediate-sell path is the ONLY liquidation
    // route — let them vendor order-book items here. Normal accounts still get
    // bounced to /api/trading-post/list.
    if (isOrderBookItem(item) && !isIronman) {
      return json({
        error: 'Restricted items must be listed on the order book via /api/trading-post/list.',
        code: 'ORDER_BOOK_REQUIRED',
      }, 400)
    }

    // Ironmen settle at the controlled Ironman vendor value (explicit
    // ironmanShopValue, else a fraction of shopValue) so liquidation can't pay
    // out the full shop/market rate. Normal accounts keep the static shopValue
    // for the General Store stock / quest-unlock items / untradeable sink they
    // reach here.
    const unit = isIronman
      ? getIronmanShopValue(item)
      : Math.floor(Number(item.shopValue) || 0)
    if (unit <= 0) return json({ error: 'This item has no shop value.', code: 'NO_VALUE' }, 400)

    normalizeSaveItemIds(saveObject, itemsData)
    removeItemFromSource(saveObject, itemId, quantity, source)
    const totalPayout = unit * quantity
    addCoins(saveObject, totalPayout)

    const write = await writeSave(env, characterId, saveObject, saveRevision)

    await auditLog(env, 'trading_post_sell_immediate', { characterId, identityId: auth.identity.id, itemId, quantity, unit, totalPayout, source }, { swallow: true })

    return json({
      ok: true,
      item_id: itemId,
      quantity,
      source,
      total_payout: totalPayout,
      save_revision: write.saveRevision,
      updatedAt: write.updatedAt,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
