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

function threeAssetBase() {
  return (typeof pocketAssetBase !== 'undefined' && pocketAssetBase) || '/'
}

// Base URL of the vendored three.js tree (trailing slash).
export function threeBase() {
  return threeAssetBase() + 'vendor/three/'
}

let _modules = null

// Resolve to { THREE, GLTFLoader, MeshoptDecoder, OrbitControls, SkeletonUtils }.
// Cached: repeated callers share one load.
export function loadThree() {
  if (_modules) return _modules
  _modules = (async () => {
    const base = threeBase()
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
