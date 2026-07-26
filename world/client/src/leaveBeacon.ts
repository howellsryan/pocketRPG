// Telling the server we're gone when the tab is closing.
//
// A `leave` frame on the WebSocket is the normal way out, but during unload
// there is no promise the frame ever leaves the machine — and if it doesn't, the
// zone falls back to the linger grace period and keeps this character's save
// lock for another ten seconds. A beacon is the request browsers do promise to
// deliver while a page is going away, so closing the browser ends the world
// session as decisively as pressing Log out.
//
// Same-origin (the world Worker serves both the client and this route), so no
// preflight — a preflighted beacon is a beacon that never arrives.
export const WORLD_LEAVE_PATH = '/api/world/leave'

export interface LeaveBeaconDeps {
  /** World session JWT; the beacon can only depart the character it names. */
  token: string | null | undefined
  /** Room (zone id, or instance room) whose Durable Object holds the player. */
  room: string | null | undefined
  origin: string
  sendBeacon?: ((url: string, body: Blob) => boolean) | null
  keepaliveFetch?: ((url: string, body: string) => void) | null
}

export type LeaveBeaconResult = 'beacon' | 'fetch' | 'skipped'

/** Fires the exit beacon, preferring sendBeacon and falling back to a keepalive
 * fetch (sendBeacon can refuse when its queue is full, and older WebKit lacks
 * it). Returns which path was taken so the behaviour is testable. */
export function sendLeaveBeacon(deps: LeaveBeaconDeps): LeaveBeaconResult {
  if (!deps.token || !deps.room) return 'skipped'
  const url = deps.origin + WORLD_LEAVE_PATH
  const body = JSON.stringify({ token: deps.token, zone: deps.room })
  if (deps.sendBeacon) {
    try {
      if (deps.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return 'beacon'
    } catch {
      // Fall through to the fetch below.
    }
  }
  if (!deps.keepaliveFetch) return 'skipped'
  deps.keepaliveFetch(url, body)
  return 'fetch'
}
