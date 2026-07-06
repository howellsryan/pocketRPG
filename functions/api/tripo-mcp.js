// Stateless MCP (Model Context Protocol) server endpoint for the Tripo AI
// bridge. Same JSON-RPC 2.0 shape as functions/api/mcp.js, but a separate,
// unrelated server: this is a developer/content-pipeline tool (generate 3D
// models / concept art via Tripo) rather than a player-facing feature, so it
// is gated by a single static bearer secret (TRIPO_MCP_TOKEN) instead of the
// game's OAuth 2.1 / session-JWT flow. See functions/_lib/tripo/schema.js for
// the tool surface and workflow.

import { json } from '../_lib/auth.js'
// TODO(security): bearer-token auth is temporarily disabled below for preview
// testing — restore both call sites before merging to main. See
// requireTripoAuth in functions/_lib/tripo/auth.js and the skipped tests in
// tests/tripoMcp.test.ts ("POST /api/tripo-mcp — auth").
// import { requireTripoAuth } from '../_lib/tripo/auth.js'
import { TOOL_SCHEMAS, SERVER_INSTRUCTIONS } from '../_lib/tripo/schema.js'
import { callTool } from '../_lib/tripo/tools.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
}

const SERVER_INFO = { name: 'PocketRPG Tripo Bridge', version: '0.1.0' }
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

// Returns a JSON-RPC response object, or null for notifications (no reply).
async function handleMessage(msg, ctx) {
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
        const result = await callTool(name, args, ctx)
        return rpcResult(id, result)
      } catch (err) {
        return rpcError(id, -32602, err?.message || 'Tool call failed')
      }
    }

    default:
      if (isNotification) return null
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

export async function onRequestPost({ request, env }) {
  // TODO(security): restore before merging to main (see import above).
  // const auth = await requireTripoAuth(request, env)
  // if (auth.error) {
  //   return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: auth.error } }, 401, CORS)
  // }

  const url = new URL(request.url)
  const ctx = { env, origin: `${url.protocol}//${url.host}` }

  let body
  try {
    body = await request.json()
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 200, CORS)
  }

  // JSON-RPC batch support.
  if (Array.isArray(body)) {
    const responses = []
    for (const msg of body) {
      const r = await handleMessage(msg, ctx)
      if (r) responses.push(r)
    }
    if (responses.length === 0) return new Response(null, { status: 202, headers: CORS })
    return json(responses, 200, CORS)
  }

  const response = await handleMessage(body, ctx)
  if (!response) return new Response(null, { status: 202, headers: CORS })
  return json(response, 200, CORS)
}

export async function onRequestGet({ request, env }) {
  // TODO(security): restore before merging to main (see import above).
  // const auth = await requireTripoAuth(request, env)
  // if (auth.error) return json({ error: auth.error }, 401, CORS)
  return json({ error: 'Method Not Allowed', hint: 'POST JSON-RPC 2.0 messages to this endpoint.' }, 405, CORS)
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}
