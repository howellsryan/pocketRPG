// POST /api/oauth/approve — called by the in-app consent screen with the
// player's session token as Authorization. Turns an approved request token into
// an authorization code (or a denial), returning the URL to bounce back to the
// MCP client.

import { requireAuth } from '../../_lib/auth.js'
import { getClient, issueCode, verifyRequestToken, oauthJson, OAUTH_CORS } from '../../_lib/oauth/store.js'

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return oauthJson({ error: 'unauthorized', error_description: auth.error }, auth.status)

  let body
  try { body = await request.json() } catch { body = null }
  const requestToken = body?.request_token
  const decision = body?.decision

  const req = await verifyRequestToken(env, requestToken)
  if (!req) return oauthJson({ error: 'invalid_request', error_description: 'Expired or invalid authorization request.' }, 400)

  // Re-validate the client/redirect still match (defends against a request
  // token replayed after the client was changed).
  const client = await getClient(env, req.client_id)
  if (!client || !client.redirectUris.includes(req.redirect_uri)) {
    return oauthJson({ error: 'invalid_request', error_description: 'Client/redirect no longer valid.' }, 400)
  }

  const redirect = new URL(req.redirect_uri)
  if (req.state) redirect.searchParams.set('state', req.state)

  if (decision !== 'allow') {
    redirect.searchParams.set('error', 'access_denied')
    return oauthJson({ redirect: redirect.toString() })
  }

  const code = await issueCode(env, {
    clientId: req.client_id,
    identityId: auth.identity.id,
    redirectUri: req.redirect_uri,
    codeChallenge: req.code_challenge,
    scope: req.scope,
  })
  redirect.searchParams.set('code', code)
  return oauthJson({ redirect: redirect.toString() })
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: OAUTH_CORS })
}
