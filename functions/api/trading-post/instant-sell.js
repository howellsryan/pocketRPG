import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInCoopSession } from '../../_lib/game/coopBoss.js'
import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { loadCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import { auditLog } from '../../_lib/game/audit.js'
import { getOwnedOffer, instantSellOffer, INSTANT_SELL_PAYOUT_FRACTION } from '../../_lib/game/tradingPost.js'

// POST /api/trading-post/instant-sell  { offer_id }
//
// Convert an active sell offer's remaining quantity into orphan stock. The
// seller is paid 80% of the item's static shopValue (not their listed price,
// which they pick freely), and the orphan stays in the order book at the
// original listed price as house stock.
export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  try {
    const body = await request.json()
    const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
    const offerId = Math.floor(Number(body?.offer_id) || 0)
    if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)
    if (offerId < 1) return json({ error: 'Invalid offer_id', code: 'INVALID_OFFER_ID' }, 400)

    // A co-op boss fight owns this save: the room is mutating the pack tick by
    // tick and replays its snapshot on write-back.
    const coopLock = await assertNotInCoopSession(env, characterId)
    if (coopLock) return coopLock

    const { row, saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, auth.identity.id)
    if (row.is_ironman) {
      return json({ error: 'Ironman characters cannot use the trading post.', code: 'IRONMAN_RESTRICTED' }, 403)
    }

    const offer = await getOwnedOffer(env, offerId, characterId)
    if (!offer) return json({ error: 'Offer not found', code: 'OFFER_NOT_FOUND' }, 404)
    if (offer.status !== 'active') return json({ error: 'Offer is not active', code: 'OFFER_INACTIVE' }, 400)

    const payout = await instantSellOffer(env, { offer, saveObject, itemsLookup: itemsData })
    const write = await writeSave(env, characterId, saveObject, saveRevision)

    await auditLog(env, 'trading_post_instant_sell', {
      characterId,
      identityId: auth.identity.id,
      offerId,
      itemId: offer.item_id,
      remaining: Number(offer.quantity_remaining) || 0,
      payout,
      payoutFraction: INSTANT_SELL_PAYOUT_FRACTION,
    }, { swallow: true })

    return json({
      ok: true,
      offer_id: offerId,
      payout,
      save_revision: write.saveRevision,
      updatedAt: write.updatedAt,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
