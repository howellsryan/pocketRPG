// Local-chat sanitiser — the only path player-authored text takes to other
// clients, so everything that renders it must use textContent (never HTML).

/** Not a display cap — players type as much as they like and the whole message
 * renders. This is only a packet ceiling on a channel that broadcasts to every
 * client in the zone; no real message comes near it. */
export const CHAT_MAX_CHARS = 2000

function isControlChar(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return code < 32 || code === 127
}

/** Trims and strips control characters. Returns null when nothing displayable
 * remains — callers drop the message. */
export function sanitizeChat(raw: string): string | null {
  const cleaned = Array.from(raw).filter((ch) => !isControlChar(ch)).join('').trim()
  if (cleaned.length === 0) return null
  return cleaned.slice(0, CHAT_MAX_CHARS)
}
