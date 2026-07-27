// Pages-side handle on a co-op boss room (the CoopBossRoom Durable Object,
// hosted in the pocketrpg-world Worker and bound here cross-script as
// COOP_ROOM — see wrangler.toml).
//
// Every room is addressed by its session id, so one session is exactly one
// object and the fight is single-threaded by construction. The endpoints under
// functions/api/coop/session/** are thin authenticated proxies over this: they
// prove who the caller is, then hand the request to the room.

import { GameApiError } from './errors.js'

/** True when this deployment can reach the rooms at all. A Pages deploy that
 * lands before the Worker one has no binding, and the picker should say group
 * fights are unavailable rather than throw on every tap. */
export function coopRoomsAvailable(env) {
  return !!env?.COOP_ROOM?.idFromName
}

function roomStub(env, sessionId) {
  if (!coopRoomsAvailable(env)) {
    throw new GameApiError('COOP_UNAVAILABLE', 'Group boss fights are temporarily unavailable', 503)
  }
  const id = env.COOP_ROOM.idFromName(`coop:${sessionId}`)
  return env.COOP_ROOM.get(id)
}

/**
 * Calls one of the room's actions ('poll' | 'intent' | 'depart').
 * The URL host is arbitrary — a DO stub routes on the object, not the name —
 * but the path is what the room switches on.
 */
export async function callCoopRoom(env, sessionId, action, payload = {}) {
  const stub = roomStub(env, sessionId)
  let res
  try {
    res = await stub.fetch(`https://coop-room/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, sessionId: Number(sessionId) }),
    })
  } catch (err) {
    // The binding can be configured while the room is still unreachable: the
    // world Worker not deployed yet, deployed without the DO class, or throwing
    // on start. That is the same situation as a missing binding — group fights
    // are off — and it must degrade the same way. Without this it surfaced as
    // an unmapped 500 with nothing in the logs to say why, because the endpoint
    // maps anything that is not a GameApiError to a bare Internal server error.
    console.error('[PocketRPG][coop] room unreachable', {
      sessionId, action, message: (err && (err.message || String(err))) || 'unknown',
    })
    throw new GameApiError('COOP_UNAVAILABLE', 'Group boss fights are temporarily unavailable', 503)
  }
  let body = null
  try { body = await res.json() } catch { /* room always speaks JSON; treat a blank as an error */ }
  return { status: res.status, body }
}
