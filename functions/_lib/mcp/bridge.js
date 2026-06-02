// Bridges an MCP tool call to an existing PocketRPG Pages Function handler.
//
// Each tool builds a synthetic request and invokes the SAME handler the
// production /api/* route uses, against the SAME `env` (and so the same D1).
// The caller's pasted session token is forwarded verbatim as the Authorization
// header, so the handler's own requireAuth / ownership checks / PvP locks /
// audit logging all run unchanged. No game logic is duplicated and the MCP
// endpoint never needs the JWT secret — it only relays a token it was given.

// Synthetic origin — handlers only read path/query/headers, never the host.
const SYNTHETIC_ORIGIN = 'https://mcp.pocketrpg.internal'

export async function callHandler(handler, env, opts = {}) {
  const { method = 'GET', authorization, characterId, body, query, path = '/api' } = opts

  const url = new URL(SYNTHETIC_ORIGIN + path)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }

  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (authorization) headers.set('Authorization', authorization)
  if (characterId !== undefined && characterId !== null) {
    headers.set('X-Character-Id', String(characterId))
  }

  const init = { method, headers }
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body)

  const request = new Request(url.toString(), init)
  const res = await handler({ request, env, waitUntil: () => {} })

  let data = null
  try { data = await res.json() } catch { data = null }
  return { status: res.status, ok: res.ok, data }
}
