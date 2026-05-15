import { requireAuth, json } from '../../_lib/auth.js'
import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { loadCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import {
  listOffersForCharacter,
  sweepPendingDeliveries,
  MAX_ACTIVE_OFFERS_PER_CHARACTER,
} from '../../_lib/game/tradingPost.js'

// GET /api/trading-post/my-offers
//
// Returns the player's offers (active + recently completed) and sweeps any
// pending coins/items from offline-matched fills into their save.
export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  try {
    const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
    if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)

    const { row, saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, auth.identity.id)
    if (row.is_ironman) {
      return json({ error: 'Ironman characters cannot use the trading post.', code: 'IRONMAN_RESTRICTED' }, 403)
    }

    const swept = await sweepPendingDeliveries(env, characterId, saveObject, itemsData)
    let writeResult = null
    if (swept) writeResult = await writeSave(env, characterId, saveObject, saveRevision)

    const offers = await listOffersForCharacter(env, characterId)
    const safeOffers = offers.map((o) => ({
      id: Number(o.id),
      offer_type: o.offer_type,
      item_id: o.item_id,
      price: Number(o.price),
      quantity_total: Number(o.quantity_total),
      quantity_remaining: Number(o.quantity_remaining),
      status: o.status,
      created_at: Number(o.created_at),
      updated_at: Number(o.updated_at),
    }))

    return json({
      ok: true,
      offers: safeOffers,
      max_slots: MAX_ACTIVE_OFFERS_PER_CHARACTER,
      ...(writeResult ? { save_revision: writeResult.saveRevision, updatedAt: writeResult.updatedAt } : {}),
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
