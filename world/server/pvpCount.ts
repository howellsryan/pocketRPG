// "N in the Wilderness" for the idle game's PvP card.
//
// Served by this Worker rather than by Pages because Pages has no binding to
// WorldZone (it binds only the two DO classes it proxies, CoopBossRoom and
// PvpMatchRoom), and the number is a public, non-sensitive occupancy count —
// so the idle client fetches it straight from the world origin under CORS
// instead of paying for a new cross-script binding and a proxy route.
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
  return new Response(JSON.stringify({ zone: PVP_ZONE_ID, count }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}
