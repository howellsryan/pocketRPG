import { requireAuth, json } from '../_lib/auth.js'
import { assertNotInActiveMatch } from '../_lib/pvp.js'

const MAX_KEYS = 50
const MAX_KEY_LENGTH = 128

function getCharacterIdFromHeaders(request) {
  const headerId = request.headers.get('X-Character-Id')
  const id = parseInt(headerId, 10)
  return Number.isFinite(id) ? id : null
}

async function assertCharacterOwned(env, characterId, identityId) {
  const row = await env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(characterId, identityId).first()
  return !!row
}

function validateEntry(key, entry) {
  if (typeof key !== 'string' || key.length < 1 || key.length > MAX_KEY_LENGTH) return false
  const pt = Math.floor(Number(entry?.progressTicks) || 0)
  if (!Number.isFinite(pt) || pt < 0) return false
  return true
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const characterId = getCharacterIdFromHeaders(request)
  if (characterId === null) return json({ error: 'Missing X-Character-Id header' }, 400)
  if (!(await assertCharacterOwned(env, characterId, auth.identity.id))) {
    return json({ error: 'Character not found' }, 404)
  }

  const rows = await env.DB.prepare(
    'SELECT activity_key, progress_ticks, total_ticks, updated_at FROM character_activity_progress WHERE character_id = ?'
  ).bind(characterId).all()

  const progress = {}
  for (const row of (rows?.results || [])) {
    progress[row.activity_key] = {
      progressTicks: row.progress_ticks,
      totalTicks: row.total_ticks ?? null,
      updatedAt: row.updated_at,
    }
  }

  return json({ progress })
}

export async function onRequestPut({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const characterId = getCharacterIdFromHeaders(request)
  if (characterId === null) return json({ error: 'Missing X-Character-Id header' }, 400)
  if (!(await assertCharacterOwned(env, characterId, auth.identity.id))) {
    return json({ error: 'Character not found' }, 404)
  }

  const lock = await assertNotInActiveMatch(env, characterId)
  if (lock) return lock

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const updates = body?.progress
  if (!updates || typeof updates !== 'object') return json({ error: 'Missing progress object' }, 400)

  const keys = Object.keys(updates)
  if (keys.length > MAX_KEYS) return json({ error: 'Too many activity keys' }, 400)

  const now = Date.now()
  const stmts = []
  for (const key of keys) {
    const entry = updates[key]
    if (!validateEntry(key, entry)) continue
    const progressTicks = Math.floor(Number(entry.progressTicks) || 0)
    const totalTicks = entry.totalTicks != null ? Math.floor(Number(entry.totalTicks)) : null
    stmts.push(
      env.DB.prepare(
        `INSERT INTO character_activity_progress (character_id, activity_key, progress_ticks, total_ticks, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(character_id, activity_key) DO UPDATE SET
           progress_ticks = excluded.progress_ticks,
           total_ticks    = excluded.total_ticks,
           updated_at     = excluded.updated_at`
      ).bind(characterId, key, progressTicks, totalTicks, now)
    )
  }

  if (stmts.length > 0) await env.DB.batch(stmts)
  return json({ ok: true, updatedAt: now })
}

export async function onRequestDelete({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const characterId = getCharacterIdFromHeaders(request)
  if (characterId === null) return json({ error: 'Missing X-Character-Id header' }, 400)
  if (!(await assertCharacterOwned(env, characterId, auth.identity.id))) {
    return json({ error: 'Character not found' }, 404)
  }

  // DELETE with ?key=... clears one entry; without key clears all (used on One-Life death)
  const url = new URL(request.url)
  const key = url.searchParams.get('key')
  if (key) {
    await env.DB.prepare(
      'DELETE FROM character_activity_progress WHERE character_id = ? AND activity_key = ?'
    ).bind(characterId, key).run()
  } else {
    await env.DB.prepare(
      'DELETE FROM character_activity_progress WHERE character_id = ?'
    ).bind(characterId).run()
  }
  return json({ ok: true })
}
