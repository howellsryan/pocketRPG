import { requireAuth, json } from '../_lib/auth.js'
import { isValidEntry, TOTAL_ENTRIES } from '../_lib/collectionLog.js'

const MAX_ENTRIES_PER_REQUEST = 64

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
    `SELECT item_id, source_type, source_id, obtained_at
       FROM collection_log
      WHERE character_id = ?`
  ).bind(ch.id).all()

  const entries = (result.results || []).map(r => ({
    itemId: r.item_id,
    sourceType: r.source_type,
    sourceId: r.source_id,
    obtainedAt: r.obtained_at,
  }))

  return json({ entries, total: TOTAL_ENTRIES })
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getCharacterId(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const incoming = Array.isArray(body?.entries) ? body.entries : null
  if (!incoming) return json({ error: 'Missing entries[]' }, 400)
  if (incoming.length === 0) return json({ ok: true, accepted: 0, rejected: 0 })
  if (incoming.length > MAX_ENTRIES_PER_REQUEST) return json({ error: 'Too many entries' }, 413)

  const now = Date.now()
  const accepted = []
  const rejected = []
  for (const e of incoming) {
    const itemId     = typeof e?.itemId     === 'string' ? e.itemId     : null
    const sourceType = typeof e?.sourceType === 'string' ? e.sourceType : null
    const sourceId   = typeof e?.sourceId   === 'string' ? e.sourceId   : null
    if (!itemId || !sourceType || !sourceId) {
      rejected.push({ ...e, reason: 'malformed' })
      continue
    }
    if (!isValidEntry(sourceType, sourceId, itemId)) {
      rejected.push({ itemId, sourceType, sourceId, reason: 'invalid_source' })
      continue
    }
    accepted.push({ itemId, sourceType, sourceId })
  }

  if (accepted.length > 0) {
    const stmts = accepted.map(e => env.DB.prepare(
      `INSERT INTO collection_log (character_id, item_id, source_type, source_id, obtained_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(character_id, item_id, source_type, source_id) DO NOTHING`
    ).bind(ch.id, e.itemId, e.sourceType, e.sourceId, now))
    await env.DB.batch(stmts)
  }

  return json({ ok: true, accepted: accepted.length, rejected: rejected.length, rejectedDetail: rejected })
}
