// GET /api/auth/google → 302 to Google OAuth
// Sets a short-lived `oauth_state` cookie for CSRF defence.

export async function onRequestGet({ request, env }) {
  if (!env.GOOGLE_CLIENT_ID) {
    return new Response('GOOGLE_CLIENT_ID not configured', { status: 500 })
  }

  const url = new URL(request.url)
  const origin = `${url.protocol}//${url.host}`
  const redirectUri = `${origin}/api/auth/google/callback`

  const stateBytes = new Uint8Array(16)
  crypto.getRandomValues(stateBytes)
  const state = Array.from(stateBytes).map(b => b.toString(16).padStart(2, '0')).join('')

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  })

  const headers = new Headers({
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    'Set-Cookie': `oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
  })
  return new Response(null, { status: 302, headers })
}
