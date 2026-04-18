import { requireAuth, json } from '../_lib/auth.js'

const MAX_SAVE_BYTES = 256 * 1024 // 256 KB ceiling — current saves are well under this

async function getCharacterId(request, env, identityId) {
  const url = new URL(request.url)
  const headerId = request.headers.get('X-Character-Id')
  const queryId = url.searchParams.get('character_id')
  const idStr = headerId || queryId
  if (!idStr) return { error: 'Missing X-Character-Id header', status: 400 }
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return { error: 'Invalid character id', status: 400 }

  // Confirm ownership
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

  const row = await env.DB.prepare(
    'SELECT save_data, updated_at FROM saves WHERE character_id = ?'
  ).bind(ch.id).first()
  if (!row) return json({ save: null })

  return json({ save: { save_data: row.save_data, updatedAt: row.updated_at } })
}

export async function onRequestPut({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getCharacterId(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const save_data = body.save_data
  if (typeof save_data !== 'string') {
    return json({ error: 'Missing save_data' }, 400)
  }
  if (save_data.length > MAX_SAVE_BYTES) {
    return json({ error: 'Save too large' }, 413)
  }

  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO saves (character_id, save_data, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET save_data = excluded.save_data, updated_at = excluded.updated_at`
  ).bind(ch.id, save_data, now).run()

  return json({ ok: true, updatedAt: now })
}
