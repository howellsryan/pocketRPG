import { requireAuth, json } from '../../_lib/auth.js'

const USERNAME_RE = /^[A-Za-z0-9_-]{3,16}$/

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const rows = await env.DB.prepare(
    `SELECT c.id, c.username, c.created_at, s.updated_at AS save_updated_at
     FROM characters c
     LEFT JOIN saves s ON s.character_id = c.id
     WHERE c.owner_id = ? AND c.deleted_at IS NULL
     ORDER BY c.created_at ASC`
  ).bind(auth.identity.id).all()

  return json({ characters: rows.results || [] })
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const username = (body.username || '').trim()

  if (!USERNAME_RE.test(username)) {
    return json({ error: 'Username must be 3–16 chars, letters/digits/_/- only' }, 400)
  }

  const reserved = await env.DB.prepare(
    'SELECT username FROM reserved_usernames WHERE username = ?'
  ).bind(username).first()
  if (reserved) return json({ error: 'That username is reserved' }, 409)

  // UNIQUE constraint catches race conditions; do a friendly pre-check too.
  const taken = await env.DB.prepare(
    'SELECT id FROM characters WHERE username = ?'
  ).bind(username).first()
  if (taken) return json({ error: 'That username is already taken' }, 409)

  const now = Date.now()
  try {
    const insert = await env.DB.prepare(
      'INSERT INTO characters (owner_id, username, created_at) VALUES (?, ?, ?)'
    ).bind(auth.identity.id, username, now).run()
    return json({
      character: {
        id: insert.meta.last_row_id,
        username,
        created_at: now,
        save_updated_at: null,
      },
    }, 201)
  } catch (err) {
    if (String(err.message || err).includes('UNIQUE')) {
      return json({ error: 'That username is already taken' }, 409)
    }
    throw err
  }
}
