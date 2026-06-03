// D1-backed OAuth state + helpers shared by the /api/oauth/** endpoints.
// Clients (from Dynamic Client Registration) and one-time auth codes live in
// D1 (migration 0022). The "authorization request" handed to the consent UI is
// a short-lived signed JWT rather than a row, so nothing extra is persisted
// between /authorize and /approve.

import { signJWT, verifyJWT } from '../jwt.js'
import { randomToken } from './pkce.js'

const CODE_TTL_SECONDS = 60
const REQUEST_TTL_SECONDS = 600

export function getOrigin(request) {
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

// Permissive CORS for the OAuth/discovery endpoints — they are called by MCP
// clients (including from browsers) and carry no cookies/credentials.
export const OAUTH_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
}

export function oauthJson(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...OAUTH_CORS, ...extraHeaders },
  })
}

// ── Clients (DCR) ────────────────────────────────────────────────────────────

export async function registerClient(env, { clientName, redirectUris }) {
  const clientId = `mcp_${randomToken(18)}`
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)',
  ).bind(clientId, clientName || null, JSON.stringify(redirectUris), now).run()
  return { clientId, createdAt: now }
}

export async function getClient(env, clientId) {
  if (!clientId) return null
  const row = await env.DB.prepare(
    'SELECT client_id, client_name, redirect_uris, created_at FROM oauth_clients WHERE client_id = ?',
  ).bind(clientId).first()
  if (!row) return null
  let redirectUris = []
  try { redirectUris = JSON.parse(row.redirect_uris) } catch { redirectUris = [] }
  return { clientId: row.client_id, clientName: row.client_name, redirectUris, createdAt: row.created_at }
}

// ── Authorization codes (single-use, PKCE-bound) ─────────────────────────────

export async function issueCode(env, { clientId, identityId, redirectUri, codeChallenge, scope }) {
  const code = randomToken(32)
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO oauth_codes
       (code, client_id, identity_id, redirect_uri, code_challenge, scope, expires_at, consumed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).bind(code, clientId, identityId, redirectUri, codeChallenge, scope || null, now + CODE_TTL_SECONDS * 1000, now).run()
  return code
}

// Atomically claim a code: flips consumed 0→1 and returns the row only if it
// was still unconsumed and unexpired. Guarantees single use under races.
export async function consumeCode(env, code) {
  if (!code) return null
  const now = Date.now()
  const claim = await env.DB.prepare(
    'UPDATE oauth_codes SET consumed = 1 WHERE code = ? AND consumed = 0 AND expires_at > ?',
  ).bind(code, now).run()
  if (!claim.meta || claim.meta.changes !== 1) return null
  return env.DB.prepare(
    'SELECT code, client_id, identity_id, redirect_uri, code_challenge, scope FROM oauth_codes WHERE code = ?',
  ).bind(code).first()
}

// ── Request token (between /authorize and /approve) ──────────────────────────

export function mintRequestToken(env, payload) {
  return signJWT({ ...payload, typ: 'oauth_req' }, env.JWT_SECRET, REQUEST_TTL_SECONDS)
}

export async function verifyRequestToken(env, token) {
  const payload = await verifyJWT(token, env.JWT_SECRET)
  if (!payload || payload.typ !== 'oauth_req') return null
  return payload
}

// ── Access token (issued at /token) ──────────────────────────────────────────
// Same shape as the session JWT minted at login, so requireAuth and every
// /api/* handler accept it unchanged.
export async function mintAccessToken(env, identity) {
  return signJWT(
    { sub: identity.id, provider: identity.provider || 'oauth', displayName: identity.displayName || null },
    env.JWT_SECRET,
    60 * 60 * 24 * 30,
  )
}
