import { json } from '../_lib/auth.js'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200

function clampInt(value, fallback, { min, max }) {
  const n = parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  if (n < min) return min
  if (n > max) return max
  return n
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url)
    const limit = clampInt(url.searchParams.get('limit'), DEFAULT_LIMIT, { min: 1, max: MAX_LIMIT })
    const offset = clampInt(url.searchParams.get('offset'), 0, { min: 0, max: 1_000_000 })

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

    return json({
      characters,
      pagination: { limit, offset, count: characters.length },
    })
  } catch (err) {
    console.error('[Leaderboard] Error fetching leaderboard:', err)
    return json({ error: 'Failed to fetch leaderboard', characters: [] }, 500)
  }
}
