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
 * Whether the deployed world Worker's rooms can actually run a raid.
 *
 * Pages and the world Worker deploy separately (§20), so a Pages build that
 * knows about raid parties can be pointed at a Worker that does not. That
 * mismatch is not a degraded raid — the old room ignores `state.raid`
 * entirely, so it respawns the raid's FIRST boss forever and settles every
 * kill against that boss's drop table. The server grants those items, so it
 * has to be a refusal, not a fallback.
 *
 * Probed against a throwaway room id: `capabilities` is answered before any
 * session lookup, so this costs no D1 and needs no session to exist. Any other
 * answer — a 404 from a room that has no such action, a 400 for the missing
 * session id it insists on, an unreachable Worker — means no raids.
 */
export async function coopRoomSupportsRaids(env) {
  if (!coopRoomsAvailable(env)) return false
  try {
    const stub = env.COOP_ROOM.get(env.COOP_ROOM.idFromName('coop:capabilities'))
    const res = await stub.fetch('https://coop-room/capabilities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const body = await res.json().catch(() => null)
    return res.status === 200 && body?.raids === true
  } catch (err) {
    console.error('[PocketRPG][coop] raid capability probe failed', {
      message: (err && (err.message || String(err))) || 'unknown',
    })
    return false
  }
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
