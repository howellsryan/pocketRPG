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
    'SELECT id, is_one_life FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(characterId, auth.identity.id).first()
  if (!character) return json({ error: 'Character not found' }, 404)
  if (!character.is_one_life) return json({ error: 'Character is not one-life' }, 400)

  await env.DB.batch([
    env.DB.prepare('DELETE FROM saves WHERE character_id = ?').bind(characterId),
    env.DB.prepare('DELETE FROM character_idle_state WHERE character_id = ?').bind(characterId),
    env.DB.prepare('DELETE FROM collection_log WHERE character_id = ?').bind(characterId),
    env.DB.prepare('DELETE FROM trading_post_offers WHERE character_id = ?').bind(characterId),
    env.DB.prepare(
      `UPDATE characters
          SET total_level = 0,
              combat_level = 3,
              active_match_id = NULL
        WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`
    ).bind(characterId, auth.identity.id),
  ])

  return json({ ok: true })
}
