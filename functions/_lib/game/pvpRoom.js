// Pages-side handle on a PvP match room (the PvpMatchRoom Durable Object,
// hosted in the pocketrpg-world Worker and bound here cross-script as PVP_ROOM
// — see wrangler.toml).
//
// Every match is addressed by its id, so one duel is exactly one object and the
// fight is single-threaded by construction. The endpoints under
// functions/api/pvp/match/[id]/** are thin authenticated proxies over this:
// they prove who the caller is, then hand the request to the room.

import { json } from '../auth.js'

/** True when this deployment can reach the rooms at all. A Pages deploy that
 * lands before the Worker one has no binding, and PvP should say so rather than
 * throw on every poll. */
export function pvpRoomsAvailable(env) {
  return !!env?.PVP_ROOM?.idFromName
}

/** Calls one of the room's actions ('poll' | 'intent' | 'depart'). */
export async function callPvpRoom(env, matchId, action, payload = {}) {
  if (!pvpRoomsAvailable(env)) {
    return { status: 503, body: { error: 'PVP_UNAVAILABLE' } }
  }
  const stub = env.PVP_ROOM.get(env.PVP_ROOM.idFromName(`pvp:${matchId}`))
  const res = await stub.fetch(`https://pvp-room/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, matchId: Number(matchId) }),
  })
  let body = null
  try { body = await res.json() } catch { /* the room always speaks JSON */ }
  return { status: res.status, body }
}

export function pvpRoomResponse({ status, body }) {
  return json(body ?? { error: 'pvp_room_unavailable' }, status)
}
