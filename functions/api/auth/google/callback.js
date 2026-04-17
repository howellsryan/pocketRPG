// GET /api/auth/google/callback?code=...&state=...
// Exchanges code → access_token, fetches Google userinfo, upserts oauth_identities,
// mints a session JWT, and redirects to / with #token=... in the URL fragment.

import { signJWT } from '../../../_lib/jwt.js'

function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

export async function onRequestGet({ request, env }) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.JWT_SECRET) {
    return new Response('Auth not fully configured', { status: 500 })
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return new Response('Missing code or state', { status: 400 })

  const cookies = parseCookies(request.headers.get('Cookie'))
  if (!cookies.oauth_state || cookies.oauth_state !== state) {
    return new Response('State mismatch — possible CSRF', { status: 400 })
  }

  const redirectUri = `${url.protocol}//${url.host}/api/auth/google/callback`

  // Exchange code for token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const tokenJson = await tokenRes.json()
  if (!tokenJson.access_token) {
    return new Response(`Google token exchange failed: ${tokenJson.error || 'unknown'}`, { status: 401 })
  }

  // Fetch userinfo
  const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { 'Authorization': `Bearer ${tokenJson.access_token}` },
  })
  if (!userRes.ok) return new Response('Failed to fetch Google user', { status: 401 })
  const gUser = await userRes.json()

  // `sub` is Google's stable unique user ID — never changes, safe for identity.
  const providerUserId = String(gUser.sub)
  const displayName = gUser.name || gUser.email || `google_${gUser.sub}`
  const email = gUser.email || null
  const now = Date.now()

  const existing = await env.DB.prepare(
    'SELECT id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?'
  ).bind('google', providerUserId).first()

  let identityId
  if (existing) {
    identityId = existing.id
    await env.DB.prepare(
      'UPDATE oauth_identities SET display_name = ?, email = ? WHERE id = ?'
    ).bind(displayName, email, identityId).run()
  } else {
    const insert = await env.DB.prepare(
      'INSERT INTO oauth_identities (provider, provider_user_id, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('google', providerUserId, email, displayName, now).run()
    identityId = insert.meta.last_row_id
  }

  const token = await signJWT(
    { sub: identityId, provider: 'google', displayName },
    env.JWT_SECRET,
    60 * 60 * 24 * 30
  )

  const redirectHeaders = new Headers({
    Location: `/#token=${encodeURIComponent(token)}`,
    'Set-Cookie': 'oauth_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
  })
  return new Response(null, { status: 302, headers: redirectHeaders })
}
