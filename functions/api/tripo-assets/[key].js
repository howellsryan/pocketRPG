// Serves assets stored by the store_asset Tripo MCP tool (functions/_lib/tripo/tools.js).
// Keys are random UUIDs (unguessable), so reads are public — these are
// generated concept art / model files, not player or account data, and the
// point of storing them is a stable url a human can open directly to review.

export async function onRequestGet({ params, env }) {
  if (!env.TRIPO_ASSETS) return new Response('R2 bucket not configured', { status: 500 })
  const obj = await env.TRIPO_ASSETS.get(params.key)
  if (!obj) return new Response('Not found', { status: 404 })
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': obj.httpEtag,
    },
  })
}
