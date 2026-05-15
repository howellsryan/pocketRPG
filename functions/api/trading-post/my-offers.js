import { requireAuth, json } from '../../_lib/auth.js'
import { loadCharacterWithSave } from '../../_lib/game/save.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import {
  listOffersForCharacter,
  MAX_ACTIVE_OFFERS_PER_CHARACTER,
} from '../../_lib/game/tradingPost.js'

// GET /api/trading-post/my-offers
//
// Returns the player's open + awaiting-collection offers. Payouts are no
// longer auto-swept; the player calls /api/trading-post/collect to claim
// pending coins/items per offer.
export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  try {
    const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
    if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)

    const { row } = await loadCharacterWithSave(env, characterId, auth.identity.id)
    if (row.is_ironman) {
      return json({ error: 'Ironman characters cannot use the trading post.', code: 'IRONMAN_RESTRICTED' }, 403)
    }

    const offers = await listOffersForCharacter(env, characterId)
    const safeOffers = offers.map((o) => ({
      id: Number(o.id),
      offer_type: o.offer_type,
      item_id: o.item_id,
      price: Number(o.price),
      quantity_total: Number(o.quantity_total),
      quantity_remaining: Number(o.quantity_remaining),
      coins_pending: Number(o.coins_pending) || 0,
      items_pending: Number(o.items_pending) || 0,
      status: o.status,
      created_at: Number(o.created_at),
      updated_at: Number(o.updated_at),
    }))

    return json({
      ok: true,
      offers: safeOffers,
      max_slots: MAX_ACTIVE_OFFERS_PER_CHARACTER,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
