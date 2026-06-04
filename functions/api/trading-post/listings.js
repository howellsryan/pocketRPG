import { requireAuth, json } from '../../_lib/auth.js'
import { toErrorResponse } from '../../_lib/game/errors.js'
import { getAllMarketListings } from '../../_lib/game/tradingPost.js'

// GET /api/trading-post/listings
//
// Returns aggregated market data for every item with ≥1 active offer.
// No character_id required — this is global read-only market data.
// Response: { ok: true, listings: [ { item_id, bestBuy, totalBuyQty, buyOfferCount, bestSell, totalSellQty, sellOfferCount }, ... ] }
export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  try {
    const listings = await getAllMarketListings(env)
    return json({ ok: true, listings })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
