// The only path player-authored text takes to other players, shared by the open
// world and co-op boss rooms so both sanitise and cap identically. Everything
// that renders the result must use textContent (never HTML).

/** Not a display cap — players type as much as they like and the whole message
 * renders. This is only a packet ceiling on a channel that broadcasts to every
 * client in the instance; no real message comes near it. */
export const CHAT_MAX_CHARS = 2000

function isControlChar(ch) {
  const code = ch.charCodeAt(0)
  return code < 32 || code === 127
}

/** Trims and strips control characters. Returns null when nothing displayable
 * remains — callers drop the message. */
export function sanitizeChat(raw) {
  if (typeof raw !== 'string') return null
  const cleaned = Array.from(raw).filter((ch) => !isControlChar(ch)).join('').trim()
  if (cleaned.length === 0) return null
  return cleaned.slice(0, CHAT_MAX_CHARS)
}

/**
 * Sliding-window send limit for one speaker. Returns the timestamps to keep
 * (already pruned of anything older than the window) and whether this message
 * is allowed — a refusal still hands back the pruned list, so a rate-limited
 * player is never stuck behind expired entries.
 */
export function chatRateVerdict(times, now, windowMs, max) {
  const recent = (times || []).filter((t) => now - t < windowMs)
  if (recent.length >= max) return { allowed: false, times: recent }
  return { allowed: true, times: [...recent, now] }
}
