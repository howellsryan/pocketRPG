import { json } from '../_lib/auth.js'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200
const CACHE_TTL_SECONDS = 60

function clampInt(value, fallback, { min, max }) {
  const n = parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  if (n < min) return min
  if (n > max) return max
  return n
}

// Build a stable cache key from the canonicalized (limit, offset) tuple so
// /api/leaderboard, /api/leaderboard?limit=100, /api/leaderboard?limit=100&offset=0
// all hit the same cache entry. Stripping unrelated query params also stops
// arbitrary `?cb=...` busters from filling the cache with duplicates.
function buildCacheKey(request, limit, offset) {
  const url = new URL(request.url)
  url.search = `?limit=${limit}&offset=${offset}`
  return new Request(url.toString(), { method: 'GET' })
}

export async function onRequestGet(context) {
  const { request, env } = context
  try {
    const url = new URL(request.url)
    const limit = clampInt(url.searchParams.get('limit'), DEFAULT_LIMIT, { min: 1, max: MAX_LIMIT })
    const offset = clampInt(url.searchParams.get('offset'), 0, { min: 0, max: 1_000_000 })

    // Edge cache: every leaderboard fetch within the TTL window is served
    // from Cloudflare's cache without touching D1. Different (limit, offset)
    // pages each get their own entry. 60s of staleness is fine for a
    // leaderboard — far cheaper than reading D1 on every page view.
    const cache = globalThis.caches?.default
    const cacheKey = cache ? buildCacheKey(request, limit, offset) : null
    if (cache && cacheKey) {
      const hit = await cache.match(cacheKey)
      if (hit) return hit
    }

    // Pure indexed read against `characters`. `total_level` / `combat_level`
    // are denormalized on every save PUT (see functions/api/save.js), so the
    // leaderboard no longer LEFT JOINs `saves` or JSON.parses save blobs.
    // Pre-migration characters with no saves stay at total_level=0 and are
    // filtered out by the partial index idx_characters_total_level_rank.
    const rows = await env.DB.prepare(
      `SELECT id, username, total_level, combat_level
         FROM characters
        WHERE deleted_at IS NULL AND total_level > 0
        ORDER BY total_level DESC, id ASC
        LIMIT ? OFFSET ?`
    ).bind(limit, offset).all()

    const characters = (rows.results || []).map(row => ({
      username: row.username,
      totalLevel: row.total_level,
      combatLevel: row.combat_level,
    }))

    const response = json(
      { characters, pagination: { limit, offset, count: characters.length } },
      200,
      { 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}` },
    )

    if (cache && cacheKey) {
      // Store a clone — the original is still streamed back to the client.
      // Use waitUntil when available so the put doesn't delay the response.
      const put = cache.put(cacheKey, response.clone())
      if (typeof context.waitUntil === 'function') context.waitUntil(put)
      else put.catch(() => {})
    }

    return response
  } catch (err) {
    console.error('[Leaderboard] Error fetching leaderboard:', err)
    return json({ error: 'Failed to fetch leaderboard', characters: [] }, 500)
  }
}
