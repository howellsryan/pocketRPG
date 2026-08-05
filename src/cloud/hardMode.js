// Read/write client for the server-owned Hard Mode switches.
//
// The rows behind these calls are what double a kill's drop rates (§14), so the
// server is the only place the switch really lives — everything the client holds
// is a mirror for rendering the toggle and for scaling the monster it fights.
// A write that fails must leave the mirror alone: a client-only "hard mode" is a
// fight twice as hard for normal drop rates.

import { api, getToken, getCharacterId } from './api.js'

/** A stable key for the mirror: `monsters:zaryth_the_shadowed`. */
export function hardModeKey(sourceType, sourceId) {
  return `${sourceType}:${sourceId}`
}

/** An { entries } payload as the mirror's key list. Shared with the
 * `hardMode` field of /api/bootstrap, which returns the identical shape. */
export function mapHardModeEntries(res) {
  return (res?.entries || [])
    .filter((e) => typeof e?.sourceId === 'string' && typeof e?.sourceType === 'string')
    .map((e) => hardModeKey(e.sourceType, e.sourceId))
}

/** The character's switches as a key list, or null when signed out. */
export async function fetchHardModeTargets() {
  if (!getToken() || !getCharacterId()) return null
  try {
    return mapHardModeEntries(await api.getHardModeTargets())
  } catch (err) {
    if (err?.status !== 401) console.warn('[hardMode] fetch failed', err)
    return null
  }
}

/** Flips one switch. Throws on failure so the caller can revert the toggle. */
export async function pushHardModeTarget(sourceType, sourceId, enabled) {
  await api.setHardModeTarget(sourceType, sourceId, enabled)
  return hardModeKey(sourceType, sourceId)
}
