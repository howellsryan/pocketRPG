export type WorldSession = { token: string; character: { id: number; name: string } }

const STORAGE_KEY = 'world_session'
const MIN_VIEWPORT_WIDTH = 768
const POCKETRPG_URL = 'https://pocketrpg.co.uk'

export function getStoredSession(): WorldSession | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.token === 'string' && parsed.character && typeof parsed.character.id === 'number') {
      return parsed as WorldSession
    }
    return null
  } catch {
    return null
  }
}

export function storeSession(session: WorldSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

/** Extracts the handoff JWT from a `#handoff=<jwt>` URL hash, if present. Pure — testable without a DOM. */
export function parseHandoffFromHash(hash: string): string | null {
  const match = /^#handoff=(.+)$/.exec(hash)
  return match ? decodeURIComponent(match[1]) : null
}

/** Whether the current viewport is too narrow for the point-and-click client. Pure — takes the two widths as args. */
export function isViewportTooNarrow(screenWidth: number, innerWidth: number): boolean {
  return Math.min(screenWidth, innerWidth) < MIN_VIEWPORT_WIDTH
}

export async function exchangeHandoff(handoff: string): Promise<WorldSession> {
  const res = await fetch('/api/world/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handoff }),
  })
  if (!res.ok) throw new Error('world_session_exchange_failed')
  const body = (await res.json()) as WorldSession
  const session: WorldSession = { token: body.token, character: body.character }
  storeSession(session)
  return session
}

export function pocketRpgUrl(): string {
  return POCKETRPG_URL
}
