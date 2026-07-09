import { signJWT, verifyJWT } from '../../functions/_lib/jwt.js'
import type { Env } from './env'

const WORLD_SESSION_EXPIRES_SECONDS = 60 * 60 * 24

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function handleWorldSession(request: Request, env: Env): Promise<Response> {
  let body: { handoff?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const handoff = typeof body.handoff === 'string' ? body.handoff : null
  if (!handoff) return jsonResponse({ error: 'Missing handoff' }, 400)

  const payload = await verifyJWT(handoff, env.JWT_SECRET)
  if (!payload || payload.scope !== 'world_handoff' || !payload.sub || !payload.character_id) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401)
  }

  const row = await env.DB.prepare(
    'SELECT id, username FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(payload.character_id, payload.sub).first<{ id: number; username: string }>()
  if (!row) return jsonResponse({ error: 'Character not found' }, 404)

  const token = await signJWT(
    { sub: payload.sub, character_id: row.id, scope: 'world' },
    env.JWT_SECRET,
    WORLD_SESSION_EXPIRES_SECONDS
  )
  return jsonResponse({ token, character: { id: row.id, name: row.username } })
}
