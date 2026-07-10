// Local-chat sanitiser — the only path player-authored text takes to other
// clients, so everything that renders it must use textContent (never HTML).

export const CHAT_MAX_CHARS = 120

function isControlChar(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return code < 32 || code === 127
}

/** Trims, strips control characters, and caps length. Returns null when
 * nothing displayable remains — callers drop the message. */
export function sanitizeChat(raw: string): string | null {
  const cleaned = Array.from(raw).filter((ch) => !isControlChar(ch)).join('').trim()
  if (cleaned.length === 0) return null
  return cleaned.slice(0, CHAT_MAX_CHARS)
}
