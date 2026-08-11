// "N in the Wilderness" for the idle game's PvP card.
//
// Answered outside the /api middleware (the world's routes always were), and
// CORS-open to `*` on purpose: the number is public and non-sensitive, and a
// native shell fetching it from capacitor://localhost is cross-origin.
import { getServerByName } from 'partyserver'
import { PVP_ZONE_ID } from '../shared/pvpArea'
import type { WorldZone } from './WorldZone'
import type { Env } from './env'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  // A count that is a few seconds stale is fine, and caching it is what stops a
  // combat screen open on twenty phones waking the DO twenty times a second.
  'Cache-Control': 'public, max-age=10',
}

export async function handlePvpCount(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  // Edge cache FIRST, and not merely as an optimisation: this route is public
  // and unauthenticated, and getServerByName WAKES the Wilderness DO. Without a
  // hit here, anyone can spin that up on demand at whatever rate they like —
  // and the honest traffic alone is a combat screen polling every 15s on every
  // open phone. `Cache-Control` on the response only instructs each browser
  // separately; this is the shared one.
  const cache = (caches as unknown as { default: Cache }).default
  const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' })
  const cached = await cache.match(cacheKey).catch(() => undefined)
  if (cached) return cached

  let count = 0
  try {
    const stub = await getServerByName<Env, WorldZone>(
      env.WorldZone as unknown as DurableObjectNamespace<WorldZone>,
      PVP_ZONE_ID,
    )
    count = await stub.playerCount()
  } catch (err) {
    // An unreachable room is reported as empty, never as an error: the card
    // this feeds is decoration, and a failed fetch must not stop anyone
    // entering the Wilderness.
    console.error('[World][pvp-count] unavailable', String(err))
  }
  const response = new Response(JSON.stringify({ zone: PVP_ZONE_ID, count }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
  await cache.put(cacheKey, response.clone()).catch(() => {})
  return response
}
