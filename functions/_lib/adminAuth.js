// Admin authorization for /api/admin/* and the /admin portal. There is no admin
// flag on an identity; the only privileged credential is the deploy-time
// ADMIN_SECRET, sent as X-Admin-Secret. An unset secret denies every request, so
// a preview or a misconfigured environment leaves the admin surface closed
// rather than open.
export const ADMIN_SECRET_HEADER = 'X-Admin-Secret'
const MIN_SECRET_LENGTH = 16

// Comparison time must not depend on how much of the secret matched, or the
// endpoint leaks it a byte at a time to anyone who can measure the response.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function isAdminRequest(request, env) {
  const expected = env?.ADMIN_SECRET
  if (typeof expected !== 'string' || expected.length < MIN_SECRET_LENGTH) return false
  const provided = request.headers.get(ADMIN_SECRET_HEADER) || ''
  if (!provided) return false
  return timingSafeEqual(provided, expected)
}
