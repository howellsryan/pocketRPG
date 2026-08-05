// Read client for the server-authoritative boss/raid kill counts.
//
// Counts live in the kill_counts table (migration 0019) and are incremented
// only by the action completion endpoints. The client fetches them on cloud
// init and feeds the boss/raid maps the combat UI displays. The local
// IndexedDB copy (gameState) is only an offline cache; the server is the
// source of truth and replaces it for logged-in characters.

import { api, getToken, getCharacterId } from './api.js'

// Splits a { entries } payload into the boss/raid maps the UI consumes
// ({ monsterId|raidId: count }). Exported so /api/bootstrap's `killCounts`
// field and this endpoint's own response go through one mapper — they are the
// same shape by contract, and a second copy is how they stop being.
export function mapKillCountEntries(res) {
  const bossKillCounts = {}
  const raidKillCounts = {}
  for (const e of (res?.entries || [])) {
    const sourceId = typeof e?.sourceId === 'string' ? e.sourceId : null
    const count = Math.max(0, Math.floor(Number(e?.killCount) || 0))
    if (!sourceId || count <= 0) continue
    if (e.sourceType === 'monsters') bossKillCounts[sourceId] = count
    else if (e.sourceType === 'raids') raidKillCounts[sourceId] = count
  }
  return { bossKillCounts, raidKillCounts }
}

// Fetches server kill counts and returns them split into the boss/raid maps
// the UI consumes. Returns null when not authenticated (guest/offline) so
// callers keep their local values.
export async function fetchKillCounts() {
  if (!getToken() || !getCharacterId()) return null
  try {
    return mapKillCountEntries(await api.getKillCounts())
  } catch (err) {
    if (err?.status !== 401) console.warn('[killCounts] fetch failed', err)
    return null
  }
}
