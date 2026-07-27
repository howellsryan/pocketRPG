// When a co-op client should ask the room for the next beat.
//
// The fight is advanced by the room's own 600ms clock, but the client used to
// wait a flat 600ms AFTER each response landed — a period of 600ms plus the
// round trip against a room beating every 600ms. Nothing accumulates (each poll
// returns the live state), but the client drifts steadily out of phase with the
// fight: most polls carry one tick, every third or fourth carries two, and the
// fight arrives in clumps. That is the stutter players read as lag, and it is
// what makes a boss's swing land before the tick that warned about it renders.
//
// The room answers with how long IS LEFT of its current beat, so aiming at that
// plus a small allowance for the trip out puts each poll just after the beat it
// wants. Deliberately relative: an absolute timestamp would be compared against
// a device clock that can be minutes off.

/** Fallback period when the room says nothing — an older Worker, or a poll that
 * failed before it answered. The tick length itself. */
export const COOP_POLL_FALLBACK_MS = 600
/** Never poll faster than this. Converging on the beat means the occasional
 * very short wait, and this is what stops that becoming a spin. */
export const COOP_POLL_MIN_MS = 120
export const COOP_POLL_MAX_MS = 1500

/**
 * Half of a measured round trip is the useful part — the leg from here to the
 * room — plus a small margin, because arriving a little late costs one render's
 * freshness while arriving early costs the whole beat.
 */
export function coopPollLead(rttMs) {
  const rtt = Math.max(0, Math.floor(Number(rttMs) || 0))
  return Math.min(250, Math.floor(rtt / 2) + 40)
}

/**
 * Delay before the next poll: what is left of the room's beat, plus the lead.
 * `nextTickInMs` is the room's own figure; anything unusable falls back to a
 * flat tick so a stale Worker still polls at the old rate.
 */
export function nextPollDelayMs(nextTickInMs, rttMs) {
  const remaining = nextTickInMs == null ? NaN : Number(nextTickInMs)
  const base = Number.isFinite(remaining) && remaining >= 0 ? remaining : COOP_POLL_FALLBACK_MS
  const delay = base + coopPollLead(rttMs)
  return Math.max(COOP_POLL_MIN_MS, Math.min(COOP_POLL_MAX_MS, Math.round(delay)))
}
