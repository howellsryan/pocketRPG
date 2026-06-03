// PKCE (RFC 7636, S256) + random token helpers. Pure crypto over Web Crypto —
// available in both the Workers runtime and the test (Node) environment.

const enc = new TextEncoder()

export function base64UrlEncode(bytes) {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes
  let s = ''
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i])
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

// A URL-safe random opaque token (client ids, auth codes).
export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

export async function sha256Base64Url(input) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return base64UrlEncode(digest)
}

// Verify a PKCE code_verifier against a stored S256 code_challenge.
export async function verifyPkceS256(codeVerifier, codeChallenge) {
  if (!codeVerifier || !codeChallenge) return false
  // RFC 7636 §4.1: verifier is 43–128 chars of the unreserved set.
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false
  const computed = await sha256Base64Url(codeVerifier)
  // Constant-time-ish compare (lengths are fixed for S256 output).
  if (computed.length !== codeChallenge.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ codeChallenge.charCodeAt(i)
  return diff === 0
}
