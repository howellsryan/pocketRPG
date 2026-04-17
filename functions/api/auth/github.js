// GET /api/auth/github → 302 to GitHub OAuth
// Sets a short-lived `oauth_state` cookie for CSRF defence.

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_CLIENT_ID) {
    return new Response('GITHUB_CLIENT_ID not configured', { status: 500 })
  }

  const url = new URL(request.url)
  const origin = `${url.protocol}//${url.host}`
  const redirectUri = `${origin}/api/auth/github/callback`

  // Random state for CSRF protection
  const stateBytes = new Uint8Array(16)
  crypto.getRandomValues(stateBytes)
  const state = Array.from(stateBytes).map(b => b.toString(16).padStart(2, '0')).join('')

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'read:user',
    state,
    allow_signup: 'true',
  })

  const headers = new Headers({
    Location: `https://github.com/login/oauth/authorize?${params}`,
    'Set-Cookie': `oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
  })
  return new Response(null, { status: 302, headers })
}
