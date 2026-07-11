import { validateExitGraph, validateZone, type ZoneDef } from '../shared/zone'
import { ZONES } from './zones'
import {
  deleteStoredZone,
  listRevisions,
  listStoredZones,
  loadRevision,
  loadStoredZone,
  saveZone,
} from './zoneStore'
import type { Env } from './env'

// Developer-only world editor API. Every route is gated by a static bearer
// secret (WORLD_EDITOR_TOKEN); with the secret unset the whole surface 503s
// rather than opening. Same-origin requests (editor served from this Worker's
// ASSETS) need no CORS; the cross-origin case is the preview-hosted editor
// publishing to the production Worker, which the allowlist below permits.

const CORS_ALLOW_METHODS = 'GET, PUT, DELETE, POST, OPTIONS'
const CORS_ALLOW_HEADERS = 'Authorization, Content-Type'

/** Reflects an allowlisted Origin: the production custom domain, any preview
 * workers.dev subdomain, or localhost for dev. The bearer token is the real
 * gate; CORS is defence-in-depth. */
function corsOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  try {
    const host = new URL(origin).hostname
    if (host === 'world.pocketrpg.co.uk' || host === 'localhost' || host === '127.0.0.1') return origin
    if (host.endsWith('.workers.dev')) return origin
  } catch {
    /* malformed Origin — no CORS */
  }
  return null
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = corsOrigin(request)
  if (!origin) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
    'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
    Vary: 'Origin',
  }
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  })
}

function authorized(request: Request, env: Env): 'ok' | 'disabled' | 'denied' {
  const secret = env.WORLD_EDITOR_TOKEN
  if (!secret) return 'disabled'
  const header = request.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  return token && token === secret ? 'ok' : 'denied'
}

function isWalkable(zone: ZoneDef, x: number, z: number): boolean {
  return zone.collision[z]?.[x] === '.'
}

/** Stored def (editor override) preferred over the bundled def. */
async function resolveDef(env: Env, id: string): Promise<{ def: ZoneDef; source: 'stored' | 'bundled' } | null> {
  const stored = await loadStoredZone(env.DB, id)
  if (stored) return { def: stored, source: 'stored' }
  const bundled = ZONES[id]
  return bundled ? { def: bundled, source: 'bundled' } : null
}

/** Cross-zone exit checks scoped to the incoming zone's OWN exits: targets must
 * exist and their arrival tiles must be walkable and not themselves exit tiles.
 * Other zones are included only as targets (their exits stripped) so a stale
 * exit elsewhere can't block this save. */
async function checkExitGraph(env: Env, zoneId: string, def: ZoneDef): Promise<string[]> {
  const map: Record<string, ZoneDef> = { [zoneId]: def }
  for (const exit of def.exits ?? []) {
    if (exit.toZone === zoneId || map[exit.toZone]) continue
    const target = (await loadStoredZone(env.DB, exit.toZone)) ?? ZONES[exit.toZone]
    if (target) map[exit.toZone] = { ...target, exits: [] }
  }
  const result = validateExitGraph(map)
  return result.valid ? [] : result.errors
}

export async function handleEditorRequest(request: Request, env: Env, pathname: string): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) })
  }

  const auth = authorized(request, env)
  if (auth === 'disabled') return json(request, { error: 'World editor is not enabled on this server.' }, 503)
  if (auth === 'denied') return json(request, { error: 'Unauthorized' }, 401)

  // pathname is the part after '/api/world/editor'
  const parts = pathname.split('/').filter(Boolean)

  // /teleport
  if (parts.length === 1 && parts[0] === 'teleport' && request.method === 'POST') {
    return handleTeleport(request, env)
  }

  // /zones ...
  if (parts[0] === 'zones') {
    if (parts.length === 1 && request.method === 'GET') return listZones(request, env)
    const id = parts[1]
    if (id) {
      if (parts.length === 2) {
        if (request.method === 'GET') return getZone(request, env, id)
        if (request.method === 'PUT') return putZone(request, env, id)
        if (request.method === 'DELETE') return deleteZone(request, env, id)
      }
      if (parts.length === 3 && parts[2] === 'revisions' && request.method === 'GET') {
        return getRevisions(request, env, id)
      }
      if (parts.length === 3 && parts[2] === 'restore' && request.method === 'POST') {
        return restoreRevision(request, env, id)
      }
    }
  }

  return json(request, { error: 'Not found' }, 404)
}

async function listZones(request: Request, env: Env): Promise<Response> {
  const stored = await listStoredZones(env.DB)
  const storedMap = new Map(stored.map((s) => [s.zoneId, s]))
  const ids = new Set<string>([...Object.keys(ZONES), ...storedMap.keys()])
  const zones = await Promise.all(
    [...ids].sort().map(async (id) => {
      const meta = storedMap.get(id)
      const isBundled = Boolean(ZONES[id])
      const source = meta ? (isBundled ? 'overridden' : 'stored') : 'bundled'
      const def = meta ? await loadStoredZone(env.DB, id) : ZONES[id]
      return {
        id,
        name: def?.name ?? id,
        width: def?.width ?? 0,
        height: def?.height ?? 0,
        source,
        ...(meta ? { revision: meta.revision, updatedAt: meta.updatedAt } : {}),
      }
    })
  )
  return json(request, { zones })
}

async function getZone(request: Request, env: Env, id: string): Promise<Response> {
  const resolved = await resolveDef(env, id)
  if (!resolved) return json(request, { error: `Unknown zone '${id}'` }, 404)
  return json(request, { def: resolved.def, source: resolved.source })
}

async function putZone(request: Request, env: Env, id: string): Promise<Response> {
  let def: ZoneDef
  try {
    def = (await request.json()) as ZoneDef
  } catch {
    return json(request, { error: 'Invalid JSON' }, 400)
  }
  if (!def || typeof def !== 'object') return json(request, { error: 'Body must be a zone definition' }, 400)
  if (def.id !== id) return json(request, { error: `Body id '${def.id}' does not match path '${id}'` }, 400)

  const structure = validateZone(def)
  if (!structure.valid) return json(request, { error: 'Zone is invalid', errors: structure.errors }, 400)
  const graphErrors = await checkExitGraph(env, id, def)
  if (graphErrors.length > 0) return json(request, { error: 'Zone is invalid', errors: graphErrors }, 400)

  const revision = await saveZone(env.DB, id, def)
  return json(request, { ok: true, id, revision })
}

async function deleteZone(request: Request, env: Env, id: string): Promise<Response> {
  const existed = await deleteStoredZone(env.DB, id)
  if (!existed) return json(request, { error: `No stored zone '${id}' to delete` }, 404)
  // Deleting the override reverts to the bundled def when one exists.
  return json(request, { ok: true, revertedToBundled: Boolean(ZONES[id]) })
}

async function getRevisions(request: Request, env: Env, id: string): Promise<Response> {
  const revisions = await listRevisions(env.DB, id)
  return json(request, { revisions })
}

async function restoreRevision(request: Request, env: Env, id: string): Promise<Response> {
  let body: { revision?: unknown }
  try {
    body = (await request.json()) as { revision?: unknown }
  } catch {
    return json(request, { error: 'Invalid JSON' }, 400)
  }
  const revision = Number(body.revision)
  if (!Number.isInteger(revision)) return json(request, { error: 'revision must be an integer' }, 400)
  const def = await loadRevision(env.DB, id, revision)
  if (!def) return json(request, { error: `No revision ${revision} for '${id}'` }, 404)
  const structure = validateZone(def)
  if (!structure.valid) return json(request, { error: 'Stored revision is invalid', errors: structure.errors }, 400)
  const newRevision = await saveZone(env.DB, id, def)
  return json(request, { ok: true, id, revision: newRevision, restoredFrom: revision })
}

/** Writes a character's world position so a brand-new zone (no inbound portal
 * yet) can be play-tested: teleport your character in, then open the world. */
async function handleTeleport(request: Request, env: Env): Promise<Response> {
  let body: { characterId?: unknown; zone?: unknown; x?: unknown; z?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json(request, { error: 'Invalid JSON' }, 400)
  }
  const characterId = Number(body.characterId)
  const zoneId = typeof body.zone === 'string' ? body.zone : ''
  const x = Number(body.x)
  const z = Number(body.z)
  if (!Number.isInteger(characterId) || !zoneId || !Number.isInteger(x) || !Number.isInteger(z)) {
    return json(request, { error: 'characterId, zone, x, z are required' }, 400)
  }
  const resolved = await resolveDef(env, zoneId)
  if (!resolved) return json(request, { error: `Unknown zone '${zoneId}'` }, 404)
  if (!isWalkable(resolved.def, x, z)) return json(request, { error: `Tile (${x},${z}) is not walkable` }, 400)

  await env.DB.prepare(
    `INSERT INTO world_positions (character_id, zone_id, x, z, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET zone_id = excluded.zone_id, x = excluded.x, z = excluded.z, updated_at = excluded.updated_at`
  ).bind(characterId, zoneId, x, z, Date.now()).run()
  return json(request, { ok: true, zone: zoneId, x, z })
}
