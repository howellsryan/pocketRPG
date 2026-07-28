// The wire format a co-op room and its clients speak over a WebSocket.
//
// Polling made every member fetch the whole projected state ~1.7 times a
// second, and a member's own record carries their pack, their worn gear, their
// levels and their quest list — kilobytes, re-sent unchanged on every beat. A
// push transport can do better, because the room knows what it told each socket
// last: it sends the fields that moved and nothing else.
//
// Pure and shared: the room builds the deltas, the client applies them, and the
// round trip is the invariant (`apply(prev, delta(prev, next))` deep-equals
// `next`) — which is testable without a Durable Object or a browser.

/** Bumped when a frame's meaning changes in a way an older peer would
 * misread. The client sends it on connect; a room that does not recognise it
 * answers a full sync every tick rather than a delta. */
export const COOP_SOCKET_PROTOCOL_VERSION = 1

/** Server → client. `sync` carries a whole projection, `tick` a delta plus the
 * events for that beat, `ack`/`nack` answer one intent, `bye` says the room is
 * finished with this socket and reconnecting will not help. */
export const COOP_FRAME_SYNC = 'sync'
export const COOP_FRAME_TICK = 'tick'
export const COOP_FRAME_ACK = 'ack'
export const COOP_FRAME_NACK = 'nack'
export const COOP_FRAME_BYE = 'bye'
export const COOP_FRAME_PONG = 'pong'
/** Client → server. */
export const COOP_FRAME_INTENT = 'intent'
export const COOP_FRAME_PING = 'ping'

/**
 * How long a member survives their socket closing before the room writes them
 * back and releases their save.
 *
 * The pull is in both directions and the balance is not obvious. Shorter is
 * better for a player who has GONE — the save lock follows the member (§20), so
 * until this lapses they cannot save their own idle game. Longer is better for
 * a player who is coming BACK, and phones close sockets for reasons that have
 * nothing to do with leaving: a locked screen, an app switch, a handover from
 * wifi to cellular. A suspended tab runs no timers at all, so it cannot even
 * reconnect until the player returns to it.
 *
 * 10s was tuned for the first case and made the second one a wipe — glancing at
 * a notification cost you the fight. Half the 90s lock TTL keeps most of the
 * release win while covering an ordinary absence, and being dropped is no
 * longer a dead end anyway: the client rejoins (see coopFeed's onLost).
 */
export const COOP_SOCKET_LINGER_MS = 45_000
/** A socket that has said nothing for this long is presumed dead by the client
 * and reconnected. The room pushes on every beat of a live fight, so silence
 * this long is not quiet — it is gone. */
export const COOP_SOCKET_IDLE_TIMEOUT_MS = 40_000
/** Client keepalive, comfortably inside the idle timeout. Also what keeps a
 * silent lobby's socket from being reaped by an intermediary. */
export const COOP_SOCKET_PING_MS = 15_000

/** Reasons the room gives for a close that reconnecting cannot fix. Anything
 * else — a dropped tunnel, a backgrounded tab, a Worker redeploy — is worth
 * another attempt on the same socket. */
const FATAL_CLOSE_REASONS = ['not_a_member', 'session_ended', 'ejected', 'flooding']

/**
 * …of which most mean only that this SESSION is no longer the player's — the
 * room let them go while they were away, or the fight ended. Reconnecting is
 * hopeless but rejoining is not, and a player who looked away for a minute
 * should be put back in a fight rather than shown a dead screen.
 */
const REJOINABLE_CLOSE_REASONS = ['not_a_member', 'session_ended', 'ejected']

export function isFatalCoopSocketReason(reason) {
  return FATAL_CLOSE_REASONS.includes(String(reason || ''))
}

export function isRejoinableCoopCloseReason(reason) {
  return REJOINABLE_CLOSE_REASONS.includes(String(reason || ''))
}

/** Attempts before a client gives up on sockets for this fight and polls
 * instead. Small on purpose: a network that cannot hold a WebSocket at all
 * should cost a couple of seconds, not a whole fight. */
export const COOP_SOCKET_MAX_ATTEMPTS = 3

/** Reconnect backoff. Starts inside one tick so an ordinary blip is invisible,
 * and doubles so a real outage is not hammered. */
export function coopSocketBackoffMs(attempt) {
  const n = Math.max(0, Math.floor(Number(attempt) || 0))
  return Math.min(8000, 500 * (2 ** n))
}

function sameValue(a, b) {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

function sameKeySet(a, b) {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!(k in b)) return false
  return true
}

function fieldPatch(before, after) {
  const patch = {}
  let changed = false
  for (const key of Object.keys(after)) {
    if (sameValue(before[key], after[key])) continue
    patch[key] = after[key]
    changed = true
  }
  return changed ? patch : null
}

/**
 * What changed between two projections of the same member's view.
 *
 * `null` means nothing did. A key set that differs at all — a member joining,
 * or a raid lobby's richer member records collapsing to the fight's public ones
 * — is answered with the whole record rather than a patch, because a patch
 * cannot express a key going away and quietly leaving one behind is how a
 * delta transport rots a client's view.
 */
export function projectionDelta(prev, next) {
  if (!next) return null
  if (!prev || !sameKeySet(prev, next)) return { full: next }

  const delta = {}
  let changed = false
  for (const key of Object.keys(next)) {
    if (key === 'members') continue
    if (sameValue(prev[key], next[key])) continue
    delta[key] = next[key]
    changed = true
  }

  const patches = {}
  const replaced = {}
  const gone = []
  const prevMembers = prev.members || {}
  const nextMembers = next.members || {}
  for (const [id, member] of Object.entries(nextMembers)) {
    const before = prevMembers[id]
    if (!before || !sameKeySet(before, member)) {
      replaced[id] = member
      changed = true
      continue
    }
    const patch = fieldPatch(before, member)
    if (patch) {
      patches[id] = patch
      changed = true
    }
  }
  for (const id of Object.keys(prevMembers)) {
    if (id in nextMembers) continue
    gone.push(id)
    changed = true
  }

  if (!changed) return null
  if (Object.keys(patches).length > 0) delta.members = patches
  if (Object.keys(replaced).length > 0) delta.membersSet = replaced
  if (gone.length > 0) delta.membersGone = gone
  return delta
}

/** Rebuilds the projection a delta describes. The inverse of projectionDelta;
 * the pair is only correct together, so change them together. */
export function applyProjectionDelta(prev, delta) {
  if (!delta) return prev ?? null
  if (delta.full) return delta.full

  const next = { ...(prev || {}) }
  for (const [key, value] of Object.entries(delta)) {
    if (key === 'members' || key === 'membersSet' || key === 'membersGone') continue
    next[key] = value
  }
  if (delta.members || delta.membersSet || delta.membersGone) {
    const members = { ...(prev?.members || {}) }
    for (const [id, record] of Object.entries(delta.membersSet || {})) members[id] = record
    for (const [id, patch] of Object.entries(delta.members || {})) members[id] = { ...(members[id] || {}), ...patch }
    for (const id of delta.membersGone || []) delete members[id]
    next.members = members
  }
  return next
}

/**
 * Whether a beat is worth a frame at all.
 *
 * The tick counter moves every 600ms whether or not anything happened, so a
 * naive "did the projection change" test is always true — and a raid party
 * sitting in a lobby would be pushed a frame a second saying only that time
 * passed. A delta whose sole content is the tick number, with no events behind
 * it, is silence.
 */
export function deltaWorthSending(delta, eventCount = 0) {
  if (eventCount > 0) return true
  if (!delta) return false
  if (delta.full) return true
  return Object.keys(delta).some((key) => key !== 'tick')
}
