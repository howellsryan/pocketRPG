import { requireAuth, json } from '../_lib/auth.js'
import { verifyJWT } from '../_lib/jwt.js'

const MAX_TASK_BYTES = 16 * 1024 // 16 KB — task JSON carries a full monster/action object; 16KB is generous

async function assertCharacterOwned(env, characterId, identityId) {
  const row = await env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(characterId, identityId).first()
  return !!row
}

function getCharacterIdFromHeaders(request) {
  const url = new URL(request.url)
  const headerId = request.headers.get('X-Character-Id')
  const queryId = url.searchParams.get('character_id')
  const idStr = headerId || queryId
  if (!idStr) return null
  const id = parseInt(idStr, 10)
  return Number.isFinite(id) ? id : null
}

function validateTaskJson(taskJson) {
  if (taskJson === null) return { ok: true, value: null }
  if (typeof taskJson !== 'string') return { ok: false, error: 'active_task must be a JSON string or null' }
  if (taskJson.length > MAX_TASK_BYTES) return { ok: false, error: 'active_task too large' }
  try { JSON.parse(taskJson) } catch { return { ok: false, error: 'active_task is not valid JSON' } }
  return { ok: true, value: taskJson }
}

async function upsertIdleRow(env, characterId, activeTaskJson) {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO character_idle_state (character_id, last_active_at, active_task, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET
       last_active_at = excluded.last_active_at,
       active_task    = excluded.active_task,
       updated_at     = excluded.updated_at`
  ).bind(characterId, now, activeTaskJson, now).run()
  return now
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const characterId = getCharacterIdFromHeaders(request)
  if (characterId === null) return json({ error: 'Missing X-Character-Id header' }, 400)

  if (!(await assertCharacterOwned(env, characterId, auth.identity.id))) {
    return json({ error: 'Character not found' }, 404)
  }

  const row = await env.DB.prepare(
    'SELECT last_active_at, active_task, updated_at FROM character_idle_state WHERE character_id = ?'
  ).bind(characterId).first()
  if (!row) return json({ idle: null })

  return json({
    idle: {
      lastActiveAt: row.last_active_at,
      activeTask: row.active_task ? JSON.parse(row.active_task) : null,
      updatedAt: row.updated_at,
    },
  })
}

export async function onRequestPut({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const characterId = getCharacterIdFromHeaders(request)
  if (characterId === null) return json({ error: 'Missing X-Character-Id header' }, 400)

  if (!(await assertCharacterOwned(env, characterId, auth.identity.id))) {
    return json({ error: 'Character not found' }, 404)
  }

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const check = validateTaskJson(body.active_task == null ? null : body.active_task)
  if (!check.ok) return json({ error: check.error }, 400)

  const now = await upsertIdleRow(env, characterId, check.value)
  return json({ ok: true, lastActiveAt: now, updatedAt: now })
}

// Beacon path: navigator.sendBeacon can't set custom headers, so we accept
// the session token and character id as body fields. Same write semantics as
// PUT — server stamps last_active_at with its own clock.
export async function onRequestPost({ request, env }) {
  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const token = typeof body.token === 'string' ? body.token : null
  if (!token) return json({ error: 'Missing token' }, 401)
  const payload = await verifyJWT(token, env.JWT_SECRET)
  if (!payload || !payload.sub) return json({ error: 'Invalid or expired token' }, 401)

  const characterId = Number.isFinite(body.character_id) ? body.character_id : parseInt(body.character_id, 10)
  if (!Number.isFinite(characterId)) return json({ error: 'Missing character_id' }, 400)

  if (!(await assertCharacterOwned(env, characterId, payload.sub))) {
    return json({ error: 'Character not found' }, 404)
  }

  const check = validateTaskJson(body.active_task == null ? null : body.active_task)
  if (!check.ok) return json({ error: check.error }, 400)

  const now = await upsertIdleRow(env, characterId, check.value)
  return json({ ok: true, lastActiveAt: now, updatedAt: now })
}
