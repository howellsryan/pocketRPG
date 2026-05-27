import { json } from '../_lib/auth.js'
import { isValidKcSource } from '../../src/engine/leaderboardFilters.js'

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

// Build a stable cache key from the canonicalized query so equivalent requests
// share an entry and arbitrary `?cb=...` busters can't fill the cache. The
// metric/source are part of the key so each filter caches independently.
function buildCacheKey(request, { metric, sourceType, sourceId, limit, offset }) {
  const url = new URL(request.url)
  url.search = `?metric=${metric}&source_type=${encodeURIComponent(sourceType)}&source_id=${encodeURIComponent(sourceId)}&limit=${limit}&offset=${offset}`
  return new Request(url.toString(), { method: 'GET' })
}

export async function onRequestGet(context) {
  const { request, env } = context
  try {
    const url = new URL(request.url)
    const limit = clampInt(url.searchParams.get('limit'), DEFAULT_LIMIT, { min: 1, max: MAX_LIMIT })
    const offset = clampInt(url.searchParams.get('offset'), 0, { min: 0, max: 1_000_000 })
    const metric = url.searchParams.get('metric') === 'kc' ? 'kc' : 'total'
    const sourceType = url.searchParams.get('source_type') || ''
    const sourceId = url.searchParams.get('source_id') || ''

    // Reject unknown KC filters up front — keeps the query bounded to known
    // bosses/raids and stops arbitrary source pairs polluting the edge cache.
    if (metric === 'kc' && !isValidKcSource(sourceType, sourceId)) {
      return json({ error: 'Invalid leaderboard filter', characters: [] }, 400)
    }

    // Edge cache: every fetch within the TTL window is served from Cloudflare's
    // cache without touching D1. Each (metric, source, limit, offset) gets its
    // own entry. 60s of staleness is fine for a leaderboard.
    const cache = globalThis.caches?.default
    const cacheKey = cache ? buildCacheKey(request, { metric, sourceType, sourceId, limit, offset }) : null
    if (cache && cacheKey) {
      const hit = await cache.match(cacheKey)
      if (hit) return hit
    }

    let characters
    if (metric === 'kc') {
      // Top killers of a given boss/raid. kill_counts is server-authoritative
      // (written only by the action completion endpoints, migration 0019) and
      // indexed by (source_type, source_id, kill_count DESC), migration 0020.
      const rows = await env.DB.prepare(
        `SELECT c.username, c.combat_level, c.is_one_life, k.kill_count
           FROM kill_counts k
           JOIN characters c ON c.id = k.character_id
          WHERE k.source_type = ? AND k.source_id = ?
            AND c.deleted_at IS NULL AND k.kill_count > 0
          ORDER BY k.kill_count DESC, c.id ASC
          LIMIT ? OFFSET ?`
      ).bind(sourceType, sourceId, limit, offset).all()
      characters = (rows.results || []).map(row => ({
        username: row.username,
        killCount: row.kill_count,
        combatLevel: row.combat_level,
        isOneLife: !!row.is_one_life,
      }))
    } else {
      // Pure indexed read against `characters`. total_level / combat_level are
      // denormalized on every save PUT (see functions/api/save.js), so this
      // never LEFT JOINs `saves` or JSON.parses save blobs.
      const rows = await env.DB.prepare(
        `SELECT id, username, total_level, combat_level, is_one_life
           FROM characters
          WHERE deleted_at IS NULL AND total_level > 33
          ORDER BY total_level DESC, id ASC
          LIMIT ? OFFSET ?`
      ).bind(limit, offset).all()
      characters = (rows.results || []).map(row => ({
        username: row.username,
        totalLevel: row.total_level,
        combatLevel: row.combat_level,
        isOneLife: !!row.is_one_life,
      }))
    }

    const response = json(
      {
        characters,
        metric,
        sourceType: metric === 'kc' ? sourceType : null,
        sourceId: metric === 'kc' ? sourceId : null,
        pagination: { limit, offset, count: characters.length },
      },
      200,
      { 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}` },
    )

    if (cache && cacheKey) {
      // Store a clone — the original is still streamed back to the client.
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
