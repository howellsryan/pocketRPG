// Resolve a character_id from headers/query, mirroring the pattern used
// in functions/api/save.js. Returns { id } or { error, status }.
export async function getOwnedCharacter(request, env, identityId) {
  const url = new URL(request.url)
  const headerId = request.headers.get('X-Character-Id')
  const queryId = url.searchParams.get('character_id')
  const idStr = headerId || queryId
  if (!idStr) return { error: 'Missing X-Character-Id header', status: 400 }
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return { error: 'Invalid character id', status: 400 }

  const row = await env.DB.prepare(
    'SELECT id, username, is_ironman, is_one_life, is_grindman FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(id, identityId).first()
  if (!row) return { error: 'Character not found', status: 404 }
  return {
    id: row.id,
    username: row.username,
    isIronman: !!row.is_ironman,
    isOneLife: !!row.is_one_life,
    isGrindman: !!row.is_grindman,
  }
}
