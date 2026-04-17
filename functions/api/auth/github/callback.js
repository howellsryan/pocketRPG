// GET /api/auth/github/callback?code=...&state=...
// Exchanges code → access_token, fetches GH user, upserts oauth_identities,
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
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.JWT_SECRET) {
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

  // Exchange code for token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.protocol}//${url.host}/api/auth/github/callback`,
    }),
  })
  const tokenJson = await tokenRes.json()
  if (!tokenJson.access_token) {
    return new Response(`GitHub token exchange failed: ${tokenJson.error || 'unknown'}`, { status: 401 })
  }

  // Fetch GH user
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${tokenJson.access_token}`,
      'User-Agent': 'PocketRPG',
      'Accept': 'application/vnd.github+json',
    },
  })
  if (!userRes.ok) return new Response('Failed to fetch GitHub user', { status: 401 })
  const ghUser = await userRes.json()

  const providerUserId = String(ghUser.id)
  const displayName = ghUser.name || ghUser.login || `gh_${ghUser.id}`
  const email = ghUser.email || null
  const now = Date.now()

  // Upsert identity
  const existing = await env.DB.prepare(
    'SELECT id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?'
  ).bind('github', providerUserId).first()

  let identityId
  if (existing) {
    identityId = existing.id
    await env.DB.prepare(
      'UPDATE oauth_identities SET display_name = ?, email = ? WHERE id = ?'
    ).bind(displayName, email, identityId).run()
  } else {
    const insert = await env.DB.prepare(
      'INSERT INTO oauth_identities (provider, provider_user_id, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('github', providerUserId, email, displayName, now).run()
    identityId = insert.meta.last_row_id
  }

  // Mint session JWT
  const token = await signJWT(
    { sub: identityId, provider: 'github', displayName },
    env.JWT_SECRET,
    60 * 60 * 24 * 30 // 30 days
  )

  // Redirect back to app with token in fragment (never sent to server)
  const redirectHeaders = new Headers({
    Location: `/#token=${encodeURIComponent(token)}`,
    'Set-Cookie': 'oauth_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
  })
  return new Response(null, { status: 302, headers: redirectHeaders })
}
