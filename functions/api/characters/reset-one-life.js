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
    `SELECT id, username, is_ironman, is_one_life
       FROM characters
      WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`
  ).bind(characterId, auth.identity.id).first()
  if (!character) return json({ error: 'Character not found' }, 404)
  if (!character.is_one_life) return json({ error: 'Character is not one-life' }, 400)

  // One-life death no longer wipes the account — it just revokes the one-life
  // flag in place. An ironman one-life character reverts to a plain Ironman;
  // a normal one-life character reverts to a plain normal account. The
  // character keeps its id, save, level and every other table untouched.
  try {
    await env.DB.prepare(
      'UPDATE characters SET is_one_life = 0 WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
    ).bind(characterId, auth.identity.id).run()
  } catch (err) {
    return json({ error: 'reset_failed', detail: String(err?.message || err) }, 500)
  }

  return json({
    ok: true,
    reverted: {
      id: character.id,
      username: character.username,
      is_ironman: !!character.is_ironman,
      is_one_life: false,
    },
  })
}
