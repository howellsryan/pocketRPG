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
  const res = await stub.fetch(`https://coop-room/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, sessionId: Number(sessionId) }),
  })
  let body = null
  try { body = await res.json() } catch { /* room always speaks JSON; treat a blank as an error */ }
  return { status: res.status, body }
}
