// One Worker, two front doors.
//
// The idle game and the open-world client are separate builds, and a Worker has
// exactly one assets directory — so the world client is staged under /world/
// (its Vite `base`, so every reference it emits already carries the prefix) and
// the world hostname is mapped onto that prefix here. That keeps the existing
// world.pocketrpg.co.uk custom domain working while preview, which has only one
// workers.dev URL for the merged Worker, reaches the same files at /world/.
//
// Only documents need this: /world/assets/* resolves as a plain asset and never
// reaches the Worker at all.

const WORLD_HOST_PREFIX = 'world.'
export const WORLD_ASSET_PREFIX = '/world'

/** Documents the world client serves at the root of its own hostname, mapped to
 * the form the asset server serves WITHOUT a redirect.
 *
 * That last part is the whole subtlety: the asset server canonicalises HTML
 * paths, so a rewrite to `/world/index.html` is answered with a 307 to
 * `/world/` — which works, but drops the player from the clean world root onto
 * a prefixed URL. Target the canonical form and the rewrite stays invisible. */
const WORLD_DOCUMENTS = {
  '/': '/',
  '/index.html': '/',
  '/editor': '/editor',
  '/editor.html': '/editor',
  '/preview': '/preview',
  '/preview.html': '/preview',
}

export function isWorldHost(hostname) {
  return typeof hostname === 'string' && hostname.startsWith(WORLD_HOST_PREFIX)
}

/**
 * The asset path a request should resolve to, or null to leave it alone.
 * Pure and hostname-driven so it can be tested without a Request.
 */
export function worldAssetPath(hostname, pathname) {
  if (!isWorldHost(hostname)) return null
  const document = WORLD_DOCUMENTS[pathname]
  if (document) return WORLD_ASSET_PREFIX + document
  if (pathname.startsWith(WORLD_ASSET_PREFIX + '/')) return null
  return WORLD_ASSET_PREFIX + pathname
}

/** Applies worldAssetPath to a Request bound for env.ASSETS. */
export function rewriteForWorldHost(request, url) {
  const rewritten = worldAssetPath(url.hostname, url.pathname)
  if (!rewritten) return request
  const target = new URL(url)
  target.pathname = rewritten
  return new Request(target, request)
}
