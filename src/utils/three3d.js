// Lazy three.js loader for the in-game 3D surfaces (equip screen, later combat).
//
// three.js is NOT bundled into the core or the game chunk — it lives as vendored
// static files under public/vendor/three/ and is fetched on demand the first
// time a 3D view mounts, then cached for the session. This keeps it off the idle
// path and out of cold-start entirely (§12 build discipline: core must never
// reference a heavy dep at module-eval time).
//
// The vendored files import each other by relative path, so only the entry URLs
// need the deployment base. `pocketAssetBase` is injected by build_single as
// '/public/' for the single-file build; Vite dev / dist leave it undefined and
// we fall back to '/'. The `@vite-ignore` hints stop Vite from trying to
// pre-bundle a dynamic import with a computed specifier.

// Candidate deployment prefixes for static assets under public/. The single-file
// build injects pocketAssetBase='/public/' (Cloudflare Pages serves the repo
// root, so public/ lives at /public/); Vite dev / dist serve public/ at '/'. We
// don't trust a hardcoded guess though — a wrong prefix 404s to the SPA HTML and
// a module import then dies with a "text/html" MIME error. So we PROBE the
// candidates once and use whichever actually serves the vendored bundle.
function assetPrefixCandidates() {
  const injected = (typeof pocketAssetBase !== 'undefined' && pocketAssetBase) || null
  return [...new Set([injected, '/public/', '/'].filter(Boolean))]
}

let _prefixP = null
// Resolve to the URL prefix (trailing slash) under which public/ assets serve.
export function detectAssetPrefix() {
  if (_prefixP) return _prefixP
  const fallback = (typeof pocketAssetBase !== 'undefined' && pocketAssetBase) || '/'
  _prefixP = (async () => {
    for (const p of assetPrefixCandidates()) {
      try {
        const r = await fetch(p + 'vendor/three/three.module.js', { method: 'HEAD' })
        const ct = r.headers.get('content-type') || ''
        if (r.ok && !ct.includes('text/html')) return p
      } catch { /* try next */ }
    }
    return fallback
  })().catch(() => fallback)
  return _prefixP
}

// Resolve a public-relative path (e.g. '3d-samples/warrior.glb') to a fetchable
// URL under the detected prefix.
export async function assetUrl(relPath) {
  if (!relPath) return null
  if (/^(https?:)?\/\//.test(relPath) || relPath.startsWith('/')) return relPath
  return (await detectAssetPrefix()) + relPath
}

let _modules = null

// Resolve to { THREE, GLTFLoader, MeshoptDecoder, OrbitControls, SkeletonUtils }.
// Cached: repeated callers share one load.
export function loadThree() {
  if (_modules) return _modules
  _modules = (async () => {
    const base = (await detectAssetPrefix()) + 'vendor/three/'
    const THREE = await import(/* @vite-ignore */ base + 'three.module.js')
    const [{ GLTFLoader }, { MeshoptDecoder }, { OrbitControls }, SkeletonUtils] = await Promise.all([
      import(/* @vite-ignore */ base + 'jsm/loaders/GLTFLoader.js'),
      import(/* @vite-ignore */ base + 'jsm/libs/meshopt_decoder.module.js'),
      import(/* @vite-ignore */ base + 'jsm/controls/OrbitControls.js'),
      import(/* @vite-ignore */ base + 'jsm/utils/SkeletonUtils.js'),
    ])
    return { THREE, GLTFLoader, MeshoptDecoder, OrbitControls, SkeletonUtils }
  })().catch((e) => { _modules = null; throw e })
  return _modules
}

// Cheap capability probe — a live 3D view should only mount where WebGL exists.
let _webgl = null
export function webglAvailable() {
  if (_webgl !== null) return _webgl
  try {
    const c = document.createElement('canvas')
    _webgl = !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')))
  } catch {
    _webgl = false
  }
  return _webgl
}

// Respect a user's Data Saver / reduced-data preference — skip the ~1 MB fetch.
export function prefersReducedData() {
  try {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-data: reduce)').matches)
  } catch {
    return false
  }
}

// Should we attempt a live 3D view at all?
export function canRender3D() {
  return webglAvailable() && !prefersReducedData()
}
