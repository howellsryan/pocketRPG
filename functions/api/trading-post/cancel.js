import { requireAuth, json } from '../../_lib/auth.js'
import { assertNotInActiveMatch } from '../../_lib/pvp.js'
import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { loadCharacterWithSave, writeSave } from '../../_lib/game/save.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import { auditLog } from '../../_lib/game/audit.js'
import { getOwnedOffer, cancelOffer } from '../../_lib/game/tradingPost.js'

// POST /api/trading-post/cancel  { offer_id }
//
// Returns escrowed items (sell) or unspent coins (buy) plus any pending
// fills back to the player. Inventory-first, bank-fallback per CLAUDE.md
// answer choice.
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
    if (offer.status !== 'active') return json({ error: 'Offer is not active', code: 'OFFER_INACTIVE' }, 400)

    await cancelOffer(env, { offer, saveObject, itemsLookup: itemsData })
    const write = await writeSave(env, characterId, saveObject, saveRevision)

    auditLog('trading_post_cancel', { characterId, offerId, itemId: offer.item_id, offerType: offer.offer_type })

    return json({
      ok: true,
      offer_id: offerId,
      save_revision: write.saveRevision,
      updatedAt: write.updatedAt,
    })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
