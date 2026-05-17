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
  await env.DB.batch([
    env.DB.prepare('DELETE FROM saves WHERE character_id = ?').bind(characterId),
    env.DB.prepare('DELETE FROM character_idle_state WHERE character_id = ?').bind(characterId),
    env.DB.prepare('DELETE FROM collection_log WHERE character_id = ?').bind(characterId),
    env.DB.prepare('DELETE FROM trading_post_offers WHERE character_id = ?').bind(characterId),
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

  return json({ ok: true, recreated: { username: character.username } })
}
