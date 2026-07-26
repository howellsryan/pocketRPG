import { verifyJWT } from '../../functions/_lib/jwt.js'
import type { Env } from './env'

// The exit beacon: an out-of-band "I'm gone" for a tab that is being closed.
//
// A closing tab can send a `leave` frame on the WebSocket, but there is no
// guarantee the frame flushes before the socket is torn down — and without it
// the zone waits out the linger grace period before releasing this character's
// save lock, which is the idle game unable to save on the way back. A beacon
// (navigator.sendBeacon / keepalive fetch) is the one request browsers promise
// to deliver during unload, so closing the browser gets the same immediate
// departure that pressing Log out does.
//
// It carries the world session JWT because it arrives with no socket and no
// cookie; a beacon can only ever depart the character its own token names.

/** Room names are DO ids taken from a URL path segment: zone ids plus the
 * instance separator. Bounded so a bogus beacon can't spin up arbitrary DOs. */
const ROOM_NAME = /^[a-z0-9_~-]{1,64}$/i

export interface LeaveBeacon {
  token: string
  room: string
}

/** Shape check on the beacon body, before any crypto or DO work. */
export function parseLeaveBeacon(body: unknown): LeaveBeacon | null {
  const token = (body as { token?: unknown } | null)?.token
  const room = (body as { zone?: unknown } | null)?.zone
  if (typeof token !== 'string' || !token) return null
  if (typeof room !== 'string' || !ROOM_NAME.test(room)) return null
  return { token, room }
}

/** Asks a room to depart a character. Injected by the caller so this module
 * stays clear of the Durable Object runtime (importing partyserver here pulls in
 * `cloudflare:workers`, which the test runner cannot load). */
export type DepartInRoom = (env: Env, room: string, charId: string) => Promise<boolean>

/** POST /api/world/leave. Always 204s on a well-formed, authentic beacon —
 * including when the room has already let the player go (the socket close beat
 * the beacon), which is a success, not an error. The sender is unloading and
 * cannot read the response either way. */
export async function handleWorldLeave(request: Request, env: Env, depart: DepartInRoom): Promise<Response> {
  const beacon = parseLeaveBeacon(await request.json().catch(() => null))
  if (!beacon) return new Response(null, { status: 400 })

  // verifyJWT throws (rather than returning null) on a token that isn't even
  // base64url, and this route is reachable by anyone.
  const payload = await verifyJWT(beacon.token, env.JWT_SECRET).catch(() => null)
  if (!payload || payload.scope !== 'world' || !payload.character_id) {
    return new Response(null, { status: 401 })
  }

  try {
    await depart(env, beacon.room, String(payload.character_id))
  } catch (err) {
    // An unreachable room is not the client's problem: the socket close still
    // releases the lock via the linger, and there is nobody left to retry.
    console.error('[World][leave] depart failed', err)
  }
  return new Response(null, { status: 204 })
}
