import { verifyJWT } from './jwt.js'

export async function requireAuth(request, env) {
  const header = request.headers.get('Authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return { error: 'Missing bearer token', status: 401 }
  const payload = await verifyJWT(match[1], env.JWT_SECRET)
  if (!payload || !payload.sub) return { error: 'Invalid or expired token', status: 401 }
  return { identity: { id: payload.sub, provider: payload.provider, displayName: payload.displayName } }
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(
    JSON.stringify(body, (_k, v) => typeof v === 'bigint' ? Number(v) : v),
    { status, headers: { 'Content-Type': 'application/json', ...extraHeaders } },
  )
}
