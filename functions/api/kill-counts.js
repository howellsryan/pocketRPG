import { requireAuth, json } from '../_lib/auth.js'

// Server-authoritative boss/raid kill counts live in the kill_counts table
// (migration 0019), written only by the action completion endpoints. This
// endpoint is read-only: the client fetches counts on boot and displays them.
async function getCharacterId(request, env, identityId) {
  const url = new URL(request.url)
  const headerId = request.headers.get('X-Character-Id')
  const queryId = url.searchParams.get('character_id')
  const idStr = headerId || queryId
  if (!idStr) return { error: 'Missing X-Character-Id header', status: 400 }
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return { error: 'Invalid character id', status: 400 }
  const row = await env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(id, identityId).first()
  if (!row) return { error: 'Character not found', status: 404 }
  return { id }
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getCharacterId(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const result = await env.DB.prepare(
    `SELECT source_type, source_id, kill_count
       FROM kill_counts
      WHERE character_id = ?`
  ).bind(ch.id).all()

  const entries = (result.results || []).map(r => ({
    sourceType: r.source_type,
    sourceId: r.source_id,
    killCount: r.kill_count,
  }))

  return json({ entries })
}
