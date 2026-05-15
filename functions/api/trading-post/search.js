import { requireAuth, json } from '../../_lib/auth.js'
import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { toErrorResponse } from '../../_lib/game/errors.js'
import { isTradingPostListable, getMarketSummary } from '../../_lib/game/tradingPost.js'

// POST /api/trading-post/search  { item_ids: string[] }
//
// Returns best bid / best ask / total listed quantity for a batch of items
// the client is rendering in a search result. Names live on the client in
// items.json so we only need to enrich with market data here.
export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  try {
    const body = await request.json()
    const requested = Array.isArray(body?.item_ids) ? body.item_ids : []
    if (requested.length > 50) {
      return json({ error: 'Too many items requested (max 50).', code: 'TOO_MANY_ITEMS' }, 400)
    }
    const valid = requested
      .filter((id) => typeof id === 'string' && id.length > 0)
      .filter((id) => isTradingPostListable(itemsData[id]))

    const market = {}
    for (const id of valid) {
      market[id] = await getMarketSummary(env, id)
    }

    return json({ ok: true, market })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
