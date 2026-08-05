// Pages Functions' file-system router, rewritten as data.
//
// Pages derived a route from a file path and dispatched on a per-method export.
// A Worker has one `fetch`, so that mapping has to be explicit — and explicit
// is the point: an unrouted handler on Pages was impossible, here it is a 404,
// and a handler that loses `_middleware` is worse than a 404 (CLAUDE.md §14 —
// the quest-gate bypass is installed per request, CORS included). Everything
// that decides which handler runs lives here, free of any handler import, so
// the whole table can be exercised in tests without the Workers runtime.

/** Path prefix whose routes are wrapped by functions/api/_middleware.js.
 * Deliberately NOT everything: `/admin` and `/.well-known/*` had no middleware
 * under Pages either, and giving them CORS now would be a silent behaviour
 * change on two surfaces that deal in secrets and OAuth metadata. */
export const MIDDLEWARE_PREFIX = '/api'

export function hasMiddleware(pathname) {
  return pathname === MIDDLEWARE_PREFIX || pathname.startsWith(MIDDLEWARE_PREFIX + '/')
}

/**
 * Turns `functions/api/coop/session/[id]/tick.js` into `/api/coop/session/:id/tick`.
 * Exported because both the generator and its drift test derive routes with it,
 * so neither can define the mapping for itself.
 */
export function routePathForFile(relativePath) {
  const withoutExt = relativePath.replace(/\.js$/, '')
  const segments = withoutExt.split('/')
  if (segments[segments.length - 1] === 'index') segments.pop()
  const mapped = segments.map((seg) => {
    const catchAll = /^\[\[(.+)\]\]$/.exec(seg)
    if (catchAll) return `*${catchAll[1]}`
    const dynamic = /^\[(.+)\]$/.exec(seg)
    if (dynamic) return `:${dynamic[1]}`
    return seg
  })
  return '/' + mapped.join('/')
}

function segmentKind(seg) {
  if (seg.startsWith('*')) return 2
  if (seg.startsWith(':')) return 1
  return 0
}

/**
 * Orders routes so a static segment always beats a dynamic one and a catch-all
 * loses to both, matching Pages' own specificity ranking. Today nothing in the
 * table actually overlaps, which is exactly why this needs to be here rather
 * than relying on declaration order — the first collision would otherwise
 * resolve by whichever line the generator happened to emit first.
 */
export function compileRoutes(routes) {
  return routes
    .map((route) => ({ ...route, segments: route.path.split('/').filter(Boolean) }))
    .sort((a, b) => {
      const len = Math.max(a.segments.length, b.segments.length)
      for (let i = 0; i < len; i++) {
        const kindA = a.segments[i] === undefined ? 3 : segmentKind(a.segments[i])
        const kindB = b.segments[i] === undefined ? 3 : segmentKind(b.segments[i])
        if (kindA !== kindB) return kindA - kindB
      }
      return b.segments.length - a.segments.length
    })
}

/** Pages treated `/api/characters` and `/api/characters/` as the same route. */
export function normalizePathname(pathname) {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

/**
 * Resolves a pathname to `{ route, params }`, or null when nothing matches.
 * A `[[key]]` catch-all yields an ARRAY of segments — `tripo-assets` joins them
 * back with '/', and handing it a bare string there would silently serve the
 * wrong R2 key for any nested asset.
 */
export function matchRoute(compiled, pathname) {
  const parts = normalizePathname(pathname).split('/').filter(Boolean)
  for (const route of compiled) {
    const params = {}
    let ok = true
    for (let i = 0; i < route.segments.length; i++) {
      const seg = route.segments[i]
      if (seg.startsWith('*')) {
        params[seg.slice(1)] = parts.slice(i)
        return { route, params }
      }
      if (i >= parts.length) { ok = false; break }
      if (seg.startsWith(':')) { params[seg.slice(1)] = parts[i]; continue }
      if (seg !== parts[i]) { ok = false; break }
    }
    if (!ok) continue
    if (parts.length !== route.segments.length) continue
    return { route, params }
  }
  return null
}

const METHOD_EXPORTS = {
  GET: 'onRequestGet',
  POST: 'onRequestPost',
  PUT: 'onRequestPut',
  PATCH: 'onRequestPatch',
  DELETE: 'onRequestDelete',
  HEAD: 'onRequestHead',
  OPTIONS: 'onRequestOptions',
}

/** The methods a module answers, for a 405's `Allow` header. */
export function allowedMethods(mod) {
  if (mod.onRequest) return Object.keys(METHOD_EXPORTS)
  return Object.entries(METHOD_EXPORTS)
    .filter(([, name]) => typeof mod[name] === 'function')
    .map(([method]) => method)
}

/**
 * Picks the export for a method. HEAD falls through to GET the way every HTTP
 * server does; the caller drops the body.
 */
export function handlerFor(mod, method) {
  const named = METHOD_EXPORTS[method]
  if (named && typeof mod[named] === 'function') return mod[named]
  if (method === 'HEAD' && typeof mod.onRequestGet === 'function') return mod.onRequestGet
  if (typeof mod.onRequest === 'function') return mod.onRequest
  return null
}
