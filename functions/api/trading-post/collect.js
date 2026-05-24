import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInActiveMatch } from '../../_lib/pvp.js'
import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { loadCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import { auditLog } from '../../_lib/game/audit.js'
import { getOwnedOffer, collectOffer } from '../../_lib/game/tradingPost.js'
import { normalizeSaveItemIds } from '../../_lib/game/inventory.js'

// POST /api/trading-post/collect  { offer_id }
//
// Pays out coins_pending / items_pending on a single offer into the player's
// save. If the offer is fully filled (remaining = 0) it transitions to
// 'completed' and disappears from My Offers; partial fills keep the offer
// active with its pending fields cleared.
export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  try {
    const body = await request.json()
    const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
    const offerId = Math.floor(Number(body?.offer_id) || 0)
    if (!characterId) return json({ error: 'Missing X-Character-Id header' }, 400)
    if (offerId < 1) return json({ error: 'Invalid offer_id', code: 'INVALID_OFFER_ID' }, 400)

    const lock = await assertNotInActiveMatch(env, characterId)
    if (lock) return lock

    const { row, saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, auth.identity.id)
    if (row.is_ironman) {
      return json({ error: 'Ironman characters cannot use the trading post.', code: 'IRONMAN_RESTRICTED' }, 403)
    }

    const offer = await getOwnedOffer(env, offerId, characterId)
    if (!offer) return json({ error: 'Offer not found', code: 'OFFER_NOT_FOUND' }, 404)

    normalizeSaveItemIds(saveObject, itemsData)

    const { coinsCollected, itemsCollected } = await collectOffer(env, {
      offer,
      saveObject,
      itemsLookup: itemsData,
    })

    const write = await writeSave(env, characterId, saveObject, saveRevision)

    await auditLog(env, 'trading_post_collect', {
      characterId,
      identityId: auth.identity.id,
      offerId,
      itemId: offer.item_id,
      coinsCollected,
      itemsCollected,
    }, { swallow: true })

    return json({
      ok: true,
      offer_id: offerId,
      coins_collected: coinsCollected,
      items_collected: itemsCollected,
      save_revision: write.saveRevision,
      updatedAt: write.updatedAt,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
