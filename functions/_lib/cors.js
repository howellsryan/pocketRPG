// CORS for native (Capacitor) clients. The browser app is same-origin with the
// API and needs no CORS; native shells load from capacitor://localhost (iOS) or
// https://localhost (Android), which are cross-origin and must be allowlisted.
//
// Auth is a Bearer token in the Authorization header (not cookies), so
// credentialed CORS / Access-Control-Allow-Credentials is intentionally absent.
const ALLOWED_ORIGINS = new Set([
  'capacitor://localhost', // iOS Capacitor WebView
  'https://localhost',     // Android Capacitor WebView
  'http://localhost',      // local native dev
])

const ALLOW_METHODS = 'GET, POST, PUT, DELETE, OPTIONS'
const ALLOW_HEADERS = 'Authorization, Content-Type, X-Character-Id'

export function isAllowedOrigin(origin) {
  return typeof origin === 'string' && ALLOWED_ORIGINS.has(origin)
}

// Headers to merge onto a response (or a preflight reply) for an allowed
// cross-origin request. Returns an empty object for same-origin/web requests so
// existing browser behaviour is untouched.
export function corsHeaders(origin) {
  if (!isAllowedOrigin(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}
