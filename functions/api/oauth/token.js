// POST /api/oauth/token — exchanges an authorization code for an access token
// (RFC 6749 §4.1.3 + PKCE). Accepts form-encoded (the OAuth default) or JSON.
// The access token issued is a standard PocketRPG session JWT.

import { consumeCode, mintAccessToken, oauthJson, OAUTH_CORS } from '../../_lib/oauth/store.js'
import { verifyPkceS256 } from '../../_lib/oauth/pkce.js'

async function readParams(request) {
  const ct = request.headers.get('Content-Type') || ''
  if (ct.includes('application/json')) {
    try { return await request.json() } catch { return {} }
  }
  // application/x-www-form-urlencoded (and a sensible default).
  try {
    const form = await request.formData()
    return Object.fromEntries(form.entries())
  } catch {
    return {}
  }
}

export async function onRequestPost({ request, env }) {
  const p = await readParams(request)

  if (p.grant_type !== 'authorization_code') {
    return oauthJson({ error: 'unsupported_grant_type' }, 400)
  }
  if (!p.code || !p.redirect_uri || !p.code_verifier) {
    return oauthJson({ error: 'invalid_request', error_description: 'Missing code, redirect_uri or code_verifier.' }, 400)
  }

  // Atomically claim the code (single use).
  const row = await consumeCode(env, p.code)
  if (!row) return oauthJson({ error: 'invalid_grant', error_description: 'Code invalid, expired or already used.' }, 400)

  if (row.redirect_uri !== p.redirect_uri) {
    return oauthJson({ error: 'invalid_grant', error_description: 'redirect_uri mismatch.' }, 400)
  }
  if (p.client_id && row.client_id !== p.client_id) {
    return oauthJson({ error: 'invalid_grant', error_description: 'client_id mismatch.' }, 400)
  }
  if (!(await verifyPkceS256(p.code_verifier, row.code_challenge))) {
    return oauthJson({ error: 'invalid_grant', error_description: 'PKCE verification failed.' }, 400)
  }

  const identity = await env.DB.prepare(
    'SELECT id, provider, display_name FROM oauth_identities WHERE id = ?',
  ).bind(row.identity_id).first()
  if (!identity) return oauthJson({ error: 'invalid_grant', error_description: 'Account no longer exists.' }, 400)

  const accessToken = await mintAccessToken(env, {
    id: identity.id,
    provider: identity.provider,
    displayName: identity.display_name,
  })

  return oauthJson({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 60 * 60 * 24 * 30,
    scope: row.scope || 'mcp',
  })
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: OAUTH_CORS })
}
