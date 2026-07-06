// Auth for the Tripo MCP bridge (functions/api/tripo-mcp.js). This is a
// developer/content-pipeline tool, not a player-facing endpoint, so it does
// not use the OAuth 2.1 / session-JWT flow the game's /api/mcp uses — just a
// single static bearer secret (TRIPO_MCP_TOKEN) known to the operator and
// whichever AI coding assistant is calling it.

async function sha256(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return new Uint8Array(digest)
}

// Constant-time compare via fixed-length digests, so neither token length
// nor content is leaked through response timing.
async function timingSafeEqual(a, b) {
  const [bytesA, bytesB] = await Promise.all([sha256(a), sha256(b)])
  let diff = 0
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i]
  return diff === 0
}

export async function requireTripoAuth(request, env) {
  if (!env.TRIPO_MCP_TOKEN) return { error: 'Server not configured (missing TRIPO_MCP_TOKEN).' }
  const header = request.headers.get('Authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return { error: 'Missing bearer token.' }
  const ok = await timingSafeEqual(match[1], env.TRIPO_MCP_TOKEN)
  if (!ok) return { error: 'Invalid token.' }
  return {}
}
