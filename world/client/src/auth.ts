export type WorldSession = { token: string; character: { id: number; name: string } }

const STORAGE_KEY = 'world_session'
const ZONE_KEY = 'world_zone'

/** Zones folded into the merged `overworld` (their standalone maps are gone as
 * player destinations). A stored position pointing at one redirects to the
 * overworld so returning players land on the one world map. */
const MERGED_ZONES = new Set(['pasture', 'forest', 'lumbright', 'varrick', 'varrick_dungeon'])

/** Redirects a merged-away zone to the overworld; passes any other id through. */
export function resolveZone(zone: string | null | undefined): string {
  if (!zone || MERGED_ZONES.has(zone)) return 'overworld'
  return zone
}

/** The zone the client should connect to: last known (welcome/transition
 * updates it), the merged overworld for a fresh browser or a folded-away zone. */
export function getStoredZone(): string {
  return resolveZone(localStorage.getItem(ZONE_KEY))
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
const POCKETRPG_PROD_HOSTNAME = 'pocketrpg.co.uk'
const POCKETRPG_PROD_URL = 'https://pocketrpg.co.uk'
const POCKETRPG_PREVIEW_URL = 'https://preview.pocketrpg.pages.dev'
const POCKETRPG_WORKERS_PREVIEW_URL = 'https://pocketrpg-app-preview.rlh.workers.dev'

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

const KNOWN_POCKETRPG_ORIGINS = [POCKETRPG_PROD_URL, POCKETRPG_PREVIEW_URL, POCKETRPG_WORKERS_PREVIEW_URL]

/** Returns to a trusted referring game, or the deployment hosting this world.
 * Unknown referrers cannot choose a redirect destination. */
export function resolvePocketRpgUrl(referrer: string, worldHostname: string): string {
  try {
    const referrerOrigin = referrer ? new URL(referrer).origin : ''
    if (KNOWN_POCKETRPG_ORIGINS.includes(referrerOrigin)) return referrerOrigin
  } catch {
    // malformed referrer — fall through to the hostname heuristic
  }
  if (worldHostname === 'pocketrpg-app-preview.rlh.workers.dev') return POCKETRPG_WORKERS_PREVIEW_URL
  return worldHostname === POCKETRPG_PROD_HOSTNAME || worldHostname === 'world.pocketrpg.co.uk'
    ? POCKETRPG_PROD_URL : POCKETRPG_PREVIEW_URL
}

export function pocketRpgUrl(): string {
  return resolvePocketRpgUrl(document.referrer, window.location.hostname)
}
