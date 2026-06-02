// GET /api/oauth/authorize — the authorization endpoint (RFC 6749 §4.1 + PKCE).
//
// We can't identify the user here (auth is a client-side JWT), so this endpoint
// validates the request and hands off to the in-app consent screen: it mints a
// short-lived signed "request token" and redirects the browser to
// `/?oauth=<request_token>`, where the SPA logs the user in (if needed) and
// POSTs their decision to /api/oauth/approve.

import { getClient, getOrigin, mintRequestToken } from '../../_lib/oauth/store.js'

function errorPage(message) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Authorization error</title>` +
    `<body style="font-family:system-ui;background:#0f0f0f;color:#e8d5b0;padding:2rem">` +
    `<h1 style="color:#d4af37">Authorization error</h1><p>${message}</p></body>`,
    { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

function redirectError(redirectUri, error, state) {
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  if (state) url.searchParams.set('state', state)
  return Response.redirect(url.toString(), 302)
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const q = url.searchParams
  const clientId = q.get('client_id')
  const redirectUri = q.get('redirect_uri')
  const state = q.get('state')

  // Validate client + redirect_uri BEFORE redirecting anywhere (open-redirect
  // defence): unknown client or unregistered redirect_uri → render an error.
  const client = await getClient(env, clientId)
  if (!client) return errorPage('Unknown client_id. Re-add the connector so it can register.')
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return errorPage('redirect_uri does not match a registered URI for this client.')
  }

  // From here, parameter errors are reported back to the client via redirect.
  if (q.get('response_type') !== 'code') return redirectError(redirectUri, 'unsupported_response_type', state)
  const codeChallenge = q.get('code_challenge')
  const method = q.get('code_challenge_method')
  if (!codeChallenge || method !== 'S256') return redirectError(redirectUri, 'invalid_request', state)

  const requestToken = await mintRequestToken(env, {
    client_id: clientId,
    client_name: client.clientName || 'An AI assistant',
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    scope: q.get('scope') || 'mcp',
    state: state || null,
  })

  const consentUrl = new URL(getOrigin(request))
  consentUrl.searchParams.set('oauth', requestToken)
  return Response.redirect(consentUrl.toString(), 302)
}
