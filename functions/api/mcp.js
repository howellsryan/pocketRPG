// Stateless MCP (Model Context Protocol) server endpoint.
//
// Speaks JSON-RPC 2.0 over HTTP (the MCP "Streamable HTTP" transport) so MCP
// clients (ChatGPT, Claude, Cursor, the MCP Inspector, …) can call PocketRPG
// tools. Stateless by design: each POST is a self-contained request, which
// suits Pages Functions (no Durable Object / session store needed).
//
// Auth is token-paste: the client sends the player's existing PocketRPG session
// token as `Authorization: Bearer <token>`. Tools forward it to the real
// /api/* handlers, which verify it exactly as the web app's calls are verified.
//
// Scope is read + server-authoritative actions (see functions/_lib/mcp). It does
// not simulate the client-side game loop.

import { json, requireAuth } from '../_lib/auth.js'
import { OAUTH_CORS } from '../_lib/oauth/store.js'
import { TOOL_SCHEMAS, SERVER_INSTRUCTIONS } from '../_lib/mcp/schema.js'
import { callTool, readResource, RESOURCE_LIST, RESOURCE_TEMPLATES } from '../_lib/mcp/tools.js'

// Unauthenticated requests get a 401 carrying a Protected Resource Metadata
// pointer (RFC 9728), which is what makes an MCP client (ChatGPT, …) start the
// OAuth discovery + authorization flow.
function unauthorized(origin) {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="PocketRPG", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
        ...OAUTH_CORS,
      },
    },
  )
}

const SERVER_INFO = { name: 'PocketRPG', version: '0.1.0' }
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

// Returns a JSON-RPC response object, or null for notifications (no reply).
async function handleMessage(msg, env, authorization, identity) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg?.id ?? null, -32600, 'Invalid Request')
  }

  const { id, method, params } = msg
  const isNotification = id === undefined || id === null

  switch (method) {
    case 'initialize': {
      const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : null
      return rpcResult(id, {
        protocolVersion: requested || DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      })
    }

    case 'ping':
      return rpcResult(id, {})

    case 'tools/list':
      return rpcResult(id, { tools: TOOL_SCHEMAS })

    case 'tools/call': {
      const name = params?.name
      const args = params?.arguments || {}
      try {
        const result = await callTool(name, args, { env, authorization, identity })
        return rpcResult(id, result)
      } catch (err) {
        // Unknown tool / bad params.
        return rpcError(id, -32602, err?.message || 'Tool call failed')
      }
    }

    case 'resources/list':
      return rpcResult(id, { resources: RESOURCE_LIST })

    case 'resources/templates/list':
      return rpcResult(id, { resourceTemplates: RESOURCE_TEMPLATES })

    case 'resources/read': {
      const uri = params?.uri
      try {
        const contents = await readResource(uri, { env, authorization, identity })
        return rpcResult(id, { contents: [contents] })
      } catch (err) {
        return rpcError(id, -32002, err?.message || `Resource not found: ${uri}`)
      }
    }

    default:
      // Notifications (e.g. notifications/initialized) get no response.
      if (isNotification) return null
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url)
  const origin = `${url.protocol}//${url.host}`

  // Transport-level auth: every MCP request must carry a valid bearer token.
  // Missing/invalid → 401 with the metadata pointer so clients start OAuth.
  const auth = await requireAuth(request, env)
  if (auth.error) return unauthorized(origin)
  const authorization = request.headers.get('Authorization')
  const identity = auth.identity

  let body
  try {
    body = await request.json()
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 200)
  }

  // JSON-RPC batch support.
  if (Array.isArray(body)) {
    const responses = []
    for (const msg of body) {
      const r = await handleMessage(msg, env, authorization, identity)
      if (r) responses.push(r)
    }
    if (responses.length === 0) return new Response(null, { status: 202 })
    return json(responses, 200)
  }

  const response = await handleMessage(body, env, authorization, identity)
  if (!response) return new Response(null, { status: 202 })
  return json(response, 200)
}

// The optional server->client SSE stream of Streamable HTTP is not implemented
// (stateless server). Unauthenticated GETs still return the 401 challenge so a
// client probing with GET can discover the OAuth flow; authenticated GETs get
// 405 and the client falls back to plain request/response.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const origin = `${url.protocol}//${url.host}`
  const auth = await requireAuth(request, env)
  if (auth.error) return unauthorized(origin)
  return json({ error: 'Method Not Allowed', hint: 'POST JSON-RPC 2.0 messages to this endpoint.' }, 405)
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: OAUTH_CORS })
}
