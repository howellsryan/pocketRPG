import { requireAuth, json } from '../../_lib/auth.js'

function getCharacterId(request) {
  const url = new URL(request.url)
  const headerId = request.headers.get('X-Character-Id')
  const queryId = url.searchParams.get('character_id')
  const idStr = headerId || queryId
  if (!idStr) return null
  const id = parseInt(idStr, 10)
  return Number.isFinite(id) ? id : null
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const characterId = getCharacterId(request)
  if (characterId == null) return json({ error: 'Missing X-Character-Id header' }, 400)

  const character = await env.DB.prepare(
    `SELECT id, username, is_ironman, is_one_life, credits, credits_used
       FROM characters
      WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`
  ).bind(characterId, auth.identity.id).first()
  if (!character) return json({ error: 'Character not found' }, 404)
  if (!character.is_one_life) return json({ error: 'Character is not one-life' }, 400)

  const now = Date.now()
  // The character row is FK-referenced by EVERY per-character table; D1 enforces
  // foreign keys, so the hard DELETE of the character fails unless we first clear
  // every child row. Missing any one of these (e.g. character_daily_tasks /
  // character_activity_progress, which an actively-played character always has)
  // makes the whole batch throw an uncaught Worker exception — the 500 that left
  // a dead one-life player un-wiped and stuck on the death screen. Keep this list
  // in lockstep with new `REFERENCES characters(id)` tables.
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM saves WHERE character_id = ?').bind(characterId),
      env.DB.prepare('DELETE FROM character_idle_state WHERE character_id = ?').bind(characterId),
      env.DB.prepare('DELETE FROM collection_log WHERE character_id = ?').bind(characterId),
      env.DB.prepare('DELETE FROM kill_counts WHERE character_id = ?').bind(characterId),
      env.DB.prepare('DELETE FROM trading_post_offers WHERE character_id = ?').bind(characterId),
      env.DB.prepare('DELETE FROM character_activity_progress WHERE character_id = ?').bind(characterId),
      env.DB.prepare('DELETE FROM character_daily_tasks WHERE character_id = ?').bind(characterId),
      // PvP tables (ironman/one-life can't PvP, but clear them so the FK delete
      // is always safe — and to cover any historical rows).
      env.DB.prepare('DELETE FROM pvp_waiting_room WHERE character_id = ?').bind(characterId),
      env.DB.prepare('DELETE FROM pvp_intents WHERE character_id = ?').bind(characterId),
      env.DB.prepare('DELETE FROM pvp_invitations WHERE from_character = ? OR to_character = ?').bind(characterId, characterId),
      env.DB.prepare('DELETE FROM pvp_matches WHERE character_a = ? OR character_b = ?').bind(characterId, characterId),
      env.DB.prepare('DELETE FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').bind(characterId, auth.identity.id),
      env.DB.prepare(
        `INSERT INTO characters
          (owner_id, username, is_ironman, is_one_life, created_at, credits, credits_used, total_level, combat_level, active_match_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 3, NULL)`
      ).bind(
        auth.identity.id,
        character.username,
        character.is_ironman ? 1 : 0,
        character.is_one_life ? 1 : 0,
        now,
        Number(character.credits) || 0,
        Number(character.credits_used) || 0,
      ),
    ])
  } catch (err) {
    // Surface a clean JSON 500 instead of an uncaught Worker exception (HTML
    // 1101). The client retries on a transient/server error, so a structured
    // failure keeps the One-Life reset flow retrying rather than dead-ending.
    return json({ error: 'reset_failed', detail: String(err?.message || err) }, 500)
  }

  const recreated = await env.DB.prepare(
    'SELECT id, username, is_one_life FROM characters WHERE owner_id = ? AND username = ? AND deleted_at IS NULL'
  ).bind(auth.identity.id, character.username).first()

  return json({
    ok: true,
    recreated: {
      id: recreated?.id || null,
      username: character.username,
      is_one_life: recreated?.is_one_life ?? 1,
    },
  })
}
