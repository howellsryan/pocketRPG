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
  // Trimmed defensively: a secret pasted into the Cloudflare dashboard (or piped
  // into `wrangler pages secret put` from `openssl rand ...`, which itself ends
  // in \n) commonly carries a trailing newline that the source never intended
  // as part of the value. The header never can — the Fetch API strips leading/
  // trailing whitespace from header values before it hits the wire — so an
  // untrimmed env var silently never matches a correctly-typed secret.
  const expected = typeof env?.ADMIN_SECRET === 'string' ? env.ADMIN_SECRET.trim() : ''
  if (expected.length < MIN_SECRET_LENGTH) return false
  const provided = (request.headers.get(ADMIN_SECRET_HEADER) || '').trim()
  if (!provided) return false
  return timingSafeEqual(provided, expected)
}
