export type WorldSession = { token: string; character: { id: number; name: string } }

const STORAGE_KEY = 'world_session'
const ZONE_KEY = 'world_zone'

/** The zone the client should connect to: last known (welcome/transition
 * updates it), 'pasture' for a fresh browser. */
export function getStoredZone(): string {
  return localStorage.getItem(ZONE_KEY) ?? 'pasture'
}

export function storeZone(zone: string): void {
  localStorage.setItem(ZONE_KEY, zone)
}

const RUN_KEY = 'world_run'

/** The run-toggle preference, persisted client-side so it survives a refresh,
 * logout, or zone transition — the server always welcomes players walking
 * (running:false), so without this the toggle would reset every reload. */
export function getRunPref(): boolean {
  return localStorage.getItem(RUN_KEY) === '1'
}

export function storeRunPref(on: boolean): void {
  localStorage.setItem(RUN_KEY, on ? '1' : '0')
}
const POCKETRPG_PROD_HOSTNAME = 'world.pocketrpg.co.uk'
const POCKETRPG_PROD_URL = 'https://pocketrpg.co.uk'
const POCKETRPG_PREVIEW_URL = 'https://preview.pocketrpg.pages.dev'

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

/** Explicit logout: drop the stored world session so the next load shows the
 * login-required screen. Leaves the last-zone hint alone (harmless). */
export function clearStoredSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/** Extracts the handoff JWT from a `#handoff=<jwt>` URL hash, if present. Pure — testable without a DOM. */
export function parseHandoffFromHash(hash: string): string | null {
  const match = /^#handoff=(.+)$/.exec(hash)
  return match ? decodeURIComponent(match[1]) : null
}

export async function exchangeHandoff(handoff: string): Promise<WorldSession> {
  const res = await fetch('/api/world/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handoff }),
  })
  if (!res.ok) {
    let detail: unknown = null
    try {
      detail = await res.json()
    } catch {
      // non-JSON error body — leave detail null
    }
    console.error('[World][auth] handoff exchange failed', { status: res.status, detail })
    throw new Error(`world_session_exchange_failed: ${res.status} ${JSON.stringify(detail)}`)
  }
  const body = (await res.json()) as WorldSession & { zone?: string }
  const session: WorldSession = { token: body.token, character: body.character }
  storeSession(session)
  if (typeof body.zone === 'string' && body.zone) storeZone(body.zone)
  return session
}

const KNOWN_POCKETRPG_ORIGINS = [POCKETRPG_PROD_URL, POCKETRPG_PREVIEW_URL]

/** Resolves which PocketRPG deployment "Go to PocketRPG" should return to.
 * Prefers the referring page — wherever the "Enter World" button was
 * actually clicked from — over the world app's own hostname, since the same
 * world deployment can be reached from either PocketRPG site. Only trusts
 * the referrer when it's one of the two known PocketRPG origins (never an
 * open redirect to an arbitrary referrer). Falls back to the world app's own
 * hostname (the production custom domain vs anything else) when the
 * referrer is missing/unrecognized — a bookmarked or reloaded world tab has
 * no referrer at all. Pure — testable without a DOM. */
export function resolvePocketRpgUrl(referrer: string, worldHostname: string): string {
  try {
    const referrerOrigin = referrer ? new URL(referrer).origin : ''
    if (KNOWN_POCKETRPG_ORIGINS.includes(referrerOrigin)) return referrerOrigin
  } catch {
    // malformed referrer — fall through to the hostname heuristic
  }
  return worldHostname === POCKETRPG_PROD_HOSTNAME ? POCKETRPG_PROD_URL : POCKETRPG_PREVIEW_URL
}

export function pocketRpgUrl(): string {
  return resolvePocketRpgUrl(document.referrer, window.location.hostname)
}
