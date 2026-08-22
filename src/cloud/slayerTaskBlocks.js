// Read client for the server-owned Slayer Task Block List (§14 purchase).
// Mirrors cloud/hardMode.js's fetch shape — the boot sequence lands this
// alongside kill counts and Hard Mode, in the same killCountsLoaded gate.

import { api, getToken, getCharacterId } from './api.js'

/** An { entries } payload as the mirror's list. Shared with the
 * `slayerTaskBlocks` field of /api/bootstrap, which returns the identical shape. */
export function mapSlayerTaskBlockEntries(res) {
  return (res?.entries || [])
    .filter((e) => typeof e?.monsterId === 'string')
    .map((e) => ({ monsterId: e.monsterId, active: e.active !== false }))
}

/** The character's blocks as [{ monsterId, active }], or null when signed out. */
export async function fetchSlayerTaskBlocks() {
  if (!getToken() || !getCharacterId()) return null
  try {
    return mapSlayerTaskBlockEntries(await api.getSlayerTaskBlocks())
  } catch (err) {
    if (err?.status !== 401) console.warn('[slayerTaskBlocks] fetch failed', err)
    return null
  }
}
