// The event ring a live-fight Durable Object keeps so a client that polls
// independently of the room's clock still sees everything that happened.
//
// Shared by the co-op boss room and the PvP match room: both advance on their
// own 600ms interval, and both have clients that arrive between beats. Neither
// can hand a client only "whatever happened on the request that woke me".

/** Ticks of history a room keeps. ~72s at 600ms, comfortably longer than the
 * poll gap a backgrounded phone produces before it is dropped anyway. */
export const ROOM_EVENT_HISTORY_TICKS = 120
/** Hard ceiling so a busy room cannot grow the ring without bound between the
 * tick-window trims. */
export const ROOM_EVENT_HISTORY_MAX = 600

/**
 * Everything that happened after the tick this client last acknowledged, up to
 * the last tick the room is willing to publish.
 *
 * `untilTick` is not decoration. Events are keyed by the tick they happened on
 * and a client acknowledges the tick it was told about, so anything appended to
 * a tick AFTER a client acknowledged it is filtered out by `> since` forever.
 * That is exactly the shape of a settlement: the engine emits the killing blow
 * immediately, then the grant takes several D1 round-trips and appends its
 * result to the same tick. A poll landing in that window used to acknowledge
 * the tick and never see the loot.
 */
export function eventsSince(events, sinceTick, untilTick = Infinity) {
  const since = Number(sinceTick)
  const until = Number(untilTick)
  if (!Array.isArray(events)) return []
  const capped = Number.isFinite(until)
    ? events.filter((ev) => (Number(ev?.tick) || 0) <= until)
    : events
  if (!Number.isFinite(since)) return [...capped]
  return capped.filter((ev) => (Number(ev?.tick) || 0) > since)
}

/** Appends a tick's events and trims the ring by both age and count. */
export function pushEvents(ring, events, currentTick) {
  const next = [...(ring || []), ...(events || [])]
  const cutoff = (Number(currentTick) || 0) - ROOM_EVENT_HISTORY_TICKS
  const aged = next.filter((ev) => (Number(ev?.tick) || 0) > cutoff)
  return aged.length > ROOM_EVENT_HISTORY_MAX ? aged.slice(-ROOM_EVENT_HISTORY_MAX) : aged
}
