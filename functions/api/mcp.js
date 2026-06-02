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

import { json } from '../_lib/auth.js'
import { TOOL_SCHEMAS } from '../_lib/mcp/schema.js'
import { callTool } from '../_lib/mcp/tools.js'

const SERVER_INFO = { name: 'PocketRPG', version: '0.1.0' }
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

// Returns a JSON-RPC response object, or null for notifications (no reply).
async function handleMessage(msg, env, authorization) {
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
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
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
        const result = await callTool(name, args, { env, authorization })
        return rpcResult(id, result)
      } catch (err) {
        // Unknown tool / bad params.
        return rpcError(id, -32602, err?.message || 'Tool call failed')
      }
    }

    default:
      // Notifications (e.g. notifications/initialized) get no response.
      if (isNotification) return null
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

export async function onRequestPost({ request, env }) {
  let body
  try {
    body = await request.json()
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 200)
  }

  const authorization = request.headers.get('Authorization') || null

  // JSON-RPC batch support.
  if (Array.isArray(body)) {
    const responses = []
    for (const msg of body) {
      const r = await handleMessage(msg, env, authorization)
      if (r) responses.push(r)
    }
    if (responses.length === 0) return new Response(null, { status: 202 })
    return json(responses, 200)
  }

  const response = await handleMessage(body, env, authorization)
  if (!response) return new Response(null, { status: 202 })
  return json(response, 200)
}

// The optional server->client SSE stream of Streamable HTTP is not implemented
// (stateless server). Clients fall back to plain request/response on 405.
export function onRequestGet() {
  return json({ error: 'Method Not Allowed', hint: 'POST JSON-RPC 2.0 messages to this endpoint.' }, 405)
}
