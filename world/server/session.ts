import { signJWT, verifyJWT } from '../../functions/_lib/jwt.js'
import { isCharacterInActiveMatch } from './pvpLock'
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
  if (!handoff) {
    console.error('[World][session] rejected: missing handoff in request body')
    return jsonResponse({ error: 'Missing handoff' }, 400)
  }

  const payload = await verifyJWT(handoff, env.JWT_SECRET)
  if (!payload) {
    console.error('[World][session] rejected: handoff JWT failed signature/expiry verification (bad JWT_SECRET, or token expired — handoffs are 60s-lived)')
    return jsonResponse({ error: 'Invalid or expired token' }, 401)
  }
  if (payload.scope !== 'world_handoff' || !payload.sub || !payload.character_id) {
    console.error('[World][session] rejected: handoff payload has wrong scope or missing claims', {
      scope: payload.scope, hasSub: Boolean(payload.sub), hasCharacterId: Boolean(payload.character_id),
    })
    return jsonResponse({ error: 'Invalid or expired token' }, 401)
  }

  const row = await env.DB.prepare(
    'SELECT id, username FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  ).bind(payload.character_id, payload.sub).first<{ id: number; username: string }>()
  if (!row) {
    console.error('[World][session] rejected: no character row found for this identity/character in the D1 this Worker is bound to', {
      identityId: payload.sub, characterId: payload.character_id, boundDatabase: 'DB',
    })
    return jsonResponse({ error: 'Character not found' }, 404)
  }

  // Refuse world entry while a PvP match is active (defence in depth behind
  // /api/world-token's check — a 60s handoff could still be replayed here).
  if (await isCharacterInActiveMatch(env, row.id)) {
    return jsonResponse({ error: 'character_in_active_match', code: 'CHARACTER_IN_ACTIVE_MATCH' }, 409)
  }

  const token = await signJWT(
    { sub: payload.sub, character_id: row.id, scope: 'world' },
    env.JWT_SECRET,
    WORLD_SESSION_EXPIRES_SECONDS
  )
  // The character's current zone, so a fresh device connects to the right DO.
  // Zones folded into the merged overworld redirect to it (mirror of
  // client/src/auth.ts MERGED_ZONES); a fresh character has no row → overworld.
  const pos = await env.DB.prepare('SELECT zone_id FROM world_positions WHERE character_id = ?')
    .bind(row.id).first<{ zone_id: string }>()
  const merged = new Set(['pasture', 'forest', 'lumbright'])
  const zone = pos && !merged.has(pos.zone_id) ? pos.zone_id : 'overworld'
  return jsonResponse({ token, character: { id: row.id, name: row.username }, zone })
}
