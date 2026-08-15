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
    const rawMetric = url.searchParams.get('metric')
    const metric = rawMetric === 'kc' ? 'kc' : rawMetric === 'ironman' ? 'ironman' : rawMetric === 'grindman' ? 'grindman' : 'total'
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
    let totalCount = 0
    if (metric === 'kc') {
      // Top killers of a given boss/raid. kill_counts is server-authoritative
      // (written only by the action completion endpoints, migration 0019) and
      // indexed by (source_type, source_id, kill_count DESC), migration 0020.
      const rows = await env.DB.prepare(
        `SELECT COUNT(*) OVER () as total_count, c.username, c.combat_level, c.is_one_life, c.is_ironman, c.is_grindman, k.kill_count
           FROM kill_counts k
           JOIN characters c ON c.id = k.character_id
          WHERE k.source_type = ? AND k.source_id = ?
            AND c.deleted_at IS NULL AND k.kill_count > 0
            AND c.is_bot = 0
          ORDER BY k.kill_count DESC, c.id ASC
          LIMIT ? OFFSET ?`
      ).bind(sourceType, sourceId, limit, offset).all()
      totalCount = rows.results?.[0]?.total_count ?? 0
      characters = (rows.results || []).map(row => ({
        username: row.username,
        killCount: row.kill_count,
        combatLevel: row.combat_level,
        isOneLife: !!row.is_one_life,
        isIronman: !!row.is_ironman,
        isGrindman: !!row.is_grindman,
      }))
    } else {
      // Pure indexed read against `characters`. total_level / combat_level are
      // denormalized on every save PUT (see functions/api/save.js), so this
      // never LEFT JOINs `saves` or JSON.parses save blobs. Ties break by
      // total_level_at (the moment the account first reached its current total
      // level) so whoever got there first ranks higher; id ASC is the final
      // tie-break. See migration 0024. The 'ironman'/'grindman' boards reuse
      // this exact query scoped to is_ironman/is_grindman accounts.
      const modeClause = metric === 'ironman' ? ' AND is_ironman = 1' : metric === 'grindman' ? ' AND is_grindman = 1' : ''
      const rows = await env.DB.prepare(
        `SELECT COUNT(*) OVER () as total_count, id, username, total_level, combat_level, is_one_life, is_ironman, is_grindman
           FROM characters
          WHERE deleted_at IS NULL AND total_level > 33 AND is_bot = 0${modeClause}
          ORDER BY total_level DESC, total_level_at ASC, id ASC
          LIMIT ? OFFSET ?`
      ).bind(limit, offset).all()
      totalCount = rows.results?.[0]?.total_count ?? 0
      characters = (rows.results || []).map(row => ({
        username: row.username,
        totalLevel: row.total_level,
        combatLevel: row.combat_level,
        isOneLife: !!row.is_one_life,
        isIronman: !!row.is_ironman,
        isGrindman: !!row.is_grindman,
      }))
    }

    const response = json(
      {
        characters,
        metric,
        sourceType: metric === 'kc' ? sourceType : null,
        sourceId: metric === 'kc' ? sourceId : null,
        pagination: { limit, offset, count: characters.length, total: totalCount },
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
