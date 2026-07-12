// Serves 3D model / art assets from the TRIPO_ASSETS R2 bucket (uploaded via
// `wrangler r2 object put`). Keys are either random UUIDs (unguessable) or
// deliberate stable paths like models/<item>.v1.glb, so reads are public —
// these are model / concept-art files, not player or account data, and the
// point of storing them is a stable url the game (equipmentModels.json) or a
// reviewing human can fetch directly.

export async function onRequestGet({ params, env }) {
  if (!env.TRIPO_ASSETS) return new Response('R2 bucket not configured', { status: 500 })
  const key = Array.isArray(params.key) ? params.key.join('/') : params.key
  if (!key || key.split('/').some((seg) => !seg || seg === '.' || seg === '..')) {
    return new Response('Not found', { status: 404 })
  }
  const obj = await env.TRIPO_ASSETS.get(key)
  if (!obj) return new Response('Not found', { status: 404 })
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': obj.httpEtag,
    },
  })
}
