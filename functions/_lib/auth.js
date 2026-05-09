import { verifyJWT } from './jwt.js'
import { writeAuditEventSafe } from './audit.js'

export async function requireAuth(request, env, context = null) {
  const header = request.headers.get('Authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    await writeAuditEventSafe(context || env, {
      eventType: 'auth_failure', severity: 'warn', requestId: context?.data?.requestId || 'unknown', characterId: 0, status: 'failed', errorCode: 'missing_bearer_token', message: 'Missing bearer token'
    })
    return { error: 'Missing bearer token', status: 401 }
  }
  const payload = await verifyJWT(match[1], env.JWT_SECRET)
  if (!payload || !payload.sub) {
    await writeAuditEventSafe(context || env, {
      eventType: 'auth_failure', severity: 'warn', requestId: context?.data?.requestId || 'unknown', characterId: 0, status: 'failed', errorCode: 'invalid_or_expired_token', message: 'Invalid or expired token'
    })
    return { error: 'Invalid or expired token', status: 401 }
  }
  return { identity: { id: payload.sub, provider: payload.provider, displayName: payload.displayName } }
}

export function json(body, status = 200, extraHeaders = {}, requestId = null) {
  return new Response(
    JSON.stringify(body, (_k, v) => typeof v === 'bigint' ? v.toString() : v),
    { status, headers: { 'Content-Type': 'application/json', ...(requestId ? { 'X-Request-Id': requestId } : {}), ...extraHeaders } },
  );
}
