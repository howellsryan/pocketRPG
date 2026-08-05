// Handle on a co-op boss room (the CoopBossRoom Durable Object, exported by
// this same Worker and bound as COOP_ROOM — see wrangler.jsonc).
//
// It used to be hosted in a second Worker and bound cross-script, because a
// Pages project cannot export a DO class. Everything that made co-op fragile
// grew out of that one constraint: the two-deploy rule, a COOP_UNAVAILABLE
// degradation for a binding that might not be there, and a capability probe
// guarding against a stale room settling every raid kill against the first
// boss's drop table. One Worker owns both now, so the binding cannot be absent
// and the room cannot be a different version than the route calling it. Don't
// reintroduce a split.
//
// Every room is addressed by its session id, so one session is exactly one
// object and the fight is single-threaded by construction. The endpoints under
// functions/api/coop/session/** are thin authenticated proxies over this: they
// prove who the caller is, then hand the request to the room.

import { GameApiError } from './errors.js'

function roomStub(env, sessionId) {
  const id = env.COOP_ROOM.idFromName(`coop:${sessionId}`)
  return env.COOP_ROOM.get(id)
}

/**
 * Opens a WebSocket to the room on the caller's behalf.
 *
 * The upgrade is a GET with no body, so the room's parameters ride the query
 * string — this URL is internal to the two Workers and never reaches a browser.
 * The caller has already been authenticated at the edge; the room decides only
 * whether this character is a member.
 *
 * Returns the room's own 101 response (whose `webSocket` the runtime splices
 * through to the client), or a plain error response. Anything other than a 101
 * — a Worker deployed before sockets existed, a room that is gone — is the
 * client's signal to fall back to polling, so it must be reported rather than
 * thrown.
 */
export async function openCoopRoomSocket(env, sessionId, { characterId, sinceTick } = {}) {
  const stub = roomStub(env, sessionId)
  const params = new URLSearchParams({ sessionId: String(Number(sessionId)), characterId: String(Number(characterId)) })
  if (Number.isFinite(sinceTick)) params.set('sinceTick', String(sinceTick))
  try {
    return await stub.fetch(`https://coop-room/socket?${params}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    })
  } catch (err) {
    console.error('[PocketRPG][coop] room socket unreachable', {
      sessionId, message: (err && (err.message || String(err))) || 'unknown',
    })
    throw new GameApiError('COOP_UNAVAILABLE', 'Group boss fights are temporarily unavailable', 503)
  }
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
