// POST /api/oauth/register — Dynamic Client Registration (RFC 7591).
// MCP clients (e.g. ChatGPT) register themselves here before the authorize
// flow. We only support public clients using PKCE (no client secret issued).

import { registerClient, oauthJson, OAUTH_CORS } from '../../_lib/oauth/store.js'

function isAllowedRedirectUri(uri) {
  if (typeof uri !== 'string') return false
  let url
  try { url = new URL(uri) } catch { return false }
  if (url.protocol === 'https:') return true
  // Allow loopback http for local tooling (MCP Inspector, dev clients).
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true
  return false
}

export async function onRequestPost({ request, env }) {
  let body
  try { body = await request.json() } catch { body = null }
  if (!body || typeof body !== 'object') {
    return oauthJson({ error: 'invalid_client_metadata', error_description: 'Body must be JSON.' }, 400)
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : []
  if (redirectUris.length === 0 || !redirectUris.every(isAllowedRedirectUri)) {
    return oauthJson(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be a non-empty array of https (or loopback http) URIs.' },
      400,
    )
  }

  const { clientId, createdAt } = await registerClient(env, {
    clientName: typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : null,
    redirectUris,
  })

  return oauthJson(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(createdAt / 1000),
      redirect_uris: redirectUris,
      client_name: body.client_name || undefined,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    },
    201,
  )
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: OAUTH_CORS })
}
