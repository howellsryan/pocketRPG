import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInActiveMatch } from '../../_lib/pvp.js'
import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { loadCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import { auditLog } from '../../_lib/game/audit.js'
import { isOrderBookItem } from '../../_lib/game/tradingPost.js'
import { removeItemFromInventory, canonicalItemId, normalizeSaveItemIds } from '../../_lib/game/inventory.js'
import { addCoins } from '../../_lib/game/economy.js'

// POST /api/trading-post/sell-immediate  { item_id, quantity }
//
// Immediate-execute sell path for general-store-tier items (anything not in
// the order book). Settles at the item's static shopValue; player gets coins,
// items leave their inventory. Boss/raid uniques and clue rewards must use
// /api/trading-post/list instead.
export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  try {
    const body = await request.json()
    const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
    const rawItemId = body?.item_id
    const quantity = Math.floor(Number(body?.quantity) || 0)
    if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)
    if (!rawItemId || typeof rawItemId !== 'string') return json({ error: 'Invalid item_id', code: 'INVALID_ITEM_ID' }, 400)
    if (quantity < 1) return json({ error: 'Quantity must be >= 1', code: 'INVALID_QUANTITY' }, 400)

    const lock = await assertNotInActiveMatch(env, characterId)
    if (lock) return lock

    const itemId = canonicalItemId(itemsData, rawItemId)
    const item = itemsData[itemId] || itemsData[rawItemId]
    if (!item) return json({ error: 'Item not found', code: 'ITEM_NOT_FOUND' }, 404)
    if (isOrderBookItem(item)) {
      return json({
        error: 'Restricted items must be listed on the order book via /api/trading-post/list.',
        code: 'ORDER_BOOK_REQUIRED',
      }, 400)
    }
    if (item.isUntradeable) {
      return json({ error: 'This item cannot be sold.', code: 'UNTRADEABLE' }, 400)
    }
    const unit = Math.floor(Number(item.shopValue) || 0)
    if (unit <= 0) return json({ error: 'This item has no shop value.', code: 'NO_VALUE' }, 400)

    const { row, saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, auth.identity.id)
    if (row.is_ironman) {
      return json({ error: 'Ironman characters cannot use the trading post.', code: 'IRONMAN_RESTRICTED' }, 403)
    }

    normalizeSaveItemIds(saveObject, itemsData)
    removeItemFromInventory(saveObject, itemId, quantity)
    const totalPayout = unit * quantity
    addCoins(saveObject, totalPayout)

    const write = await writeSave(env, characterId, saveObject, saveRevision)

    auditLog('trading_post_sell_immediate', { characterId, itemId, quantity, unit, totalPayout })

    return json({
      ok: true,
      item_id: itemId,
      quantity,
      total_payout: totalPayout,
      save_revision: write.saveRevision,
      updatedAt: write.updatedAt,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
