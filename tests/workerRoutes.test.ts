// The router replaced Pages' file-system routing, so the guarantees Pages gave
// for free now have to be asserted. Two of them matter more than the rest:
//
//   A handler that is not in the table is a 404 in production — silent, and
//   invisible to the type-checker, because nothing imports it.
//   A handler that loses the /api middleware is worse: CLAUDE.md §14's
//   integrity boundary lives inside these routes, and the quest-gate bypass is
//   installed per request by that middleware.
//
// Everything here derives its expectations from the functions/ tree, never from
// a copy of the table, so the tests cannot drift into agreeing with a mistake.

import { describe, it, expect, afterEach } from 'vitest'
import { resolve } from 'node:path'
import {
  compileRoutes,
  routePathForFile,
  matchRoute,
  normalizePathname,
  handlerFor,
  allowedMethods,
  hasMiddleware,
} from '../worker/router.js'
import { ROUTE_MODULES } from '../worker/routes.js'
import { routeFiles, moduleIdentifier } from '../scripts/gen-worker-routes.mjs'
import { onRequest as apiMiddleware } from '../functions/api/_middleware.js'
import {
  questGatesDisabled,
  resolveQuestGateBypass,
  setQuestGateBypass,
} from '../src/engine/questGates.js'

// Module-scoped by design (it is deployment-constant), so leaving it installed
// would leak into every later test file in this worker.
afterEach(() => { setQuestGateBypass(false) })

const root = (p: string) => resolve(__dirname, '..', p)
const FUNCTIONS = root('functions')

const tableFiles = ROUTE_MODULES.map((r: { file: string }) => r.file)
const compiled = compileRoutes(
  ROUTE_MODULES.map(({ file, module }: { file: string; module: unknown }) => ({
    path: routePathForFile(file),
    module,
  }))
)

describe('every handler is routed', () => {
  it('covers the functions/ tree exactly — no missing route, no stale entry', () => {
    expect([...tableFiles].sort()).toEqual([...routeFiles(FUNCTIONS)].sort())
  })

  it('routes 67 files, so a table that silently empties itself fails', () => {
    expect(tableFiles.length).toBeGreaterThan(60)
  })

  it('skips the underscore-prefixed files Pages treated as non-routes', () => {
    expect(tableFiles.some((f: string) => f.split('/').some((s) => s.startsWith('_')))).toBe(false)
    expect(tableFiles).not.toContain('api/_middleware.js')
    expect(tableFiles).not.toContain('api/actions/_completeShared.js')
  })

  it('imports each module under a unique identifier', () => {
    const ids = tableFiles.map(moduleIdentifier)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('exports at least one dispatchable handler from every routed module', () => {
    const dead = ROUTE_MODULES.filter(
      ({ module }: { module: Record<string, unknown> }) => allowedMethods(module).length === 0
    )
    expect(dead.map((d: { file: string }) => d.file)).toEqual([])
  })
})

describe('the URL each file answers', () => {
  it('drops index and maps both dynamic segment forms', () => {
    expect(routePathForFile('api/save.js')).toBe('/api/save')
    expect(routePathForFile('api/characters/index.js')).toBe('/api/characters')
    expect(routePathForFile('api/coop/session/[id].js')).toBe('/api/coop/session/:id')
    expect(routePathForFile('api/coop/session/[id]/tick.js')).toBe('/api/coop/session/:id/tick')
    expect(routePathForFile('api/tripo-assets/[[key]].js')).toBe('/api/tripo-assets/*key')
    expect(routePathForFile('.well-known/oauth-protected-resource.js'))
      .toBe('/.well-known/oauth-protected-resource')
    expect(routePathForFile('admin.js')).toBe('/admin')
  })

  it('has exactly the three dynamic routes the migration accounted for', () => {
    const dynamic = tableFiles.map(routePathForFile).filter((p: string) => /[:*]/.test(p))
    expect(dynamic.sort()).toEqual([
      '/api/coop/session/:id',
      '/api/coop/session/:id/intent',
      '/api/coop/session/:id/leave',
      '/api/coop/session/:id/socket',
      '/api/coop/session/:id/tick',
      '/api/tripo-assets/*key',
    ])
  })
})

describe('matching', () => {
  it('resolves a static route', () => {
    expect(matchRoute(compiled, '/api/save')?.route.path).toBe('/api/save')
  })

  it('treats a trailing slash as the same route, as Pages did', () => {
    expect(normalizePathname('/api/characters/')).toBe('/api/characters')
    expect(matchRoute(compiled, '/api/characters/')?.route.path).toBe('/api/characters')
  })

  it('extracts a dynamic segment', () => {
    const m = matchRoute(compiled, '/api/coop/session/42/tick')
    expect(m?.route.path).toBe('/api/coop/session/:id/tick')
    expect(m?.params.id).toBe('42')
  })

  it('prefers the deeper static route over the shallower dynamic one', () => {
    expect(matchRoute(compiled, '/api/coop/session/42')?.route.path).toBe('/api/coop/session/:id')
    expect(matchRoute(compiled, '/api/coop/raids')?.route.path).toBe('/api/coop/raids')
  })

  it('hands a catch-all an ARRAY of segments', () => {
    // tripo-assets joins these back with '/', so a bare string would resolve
    // the wrong R2 key for every nested asset.
    const m = matchRoute(compiled, '/api/tripo-assets/models/zaryth/body.glb')
    expect(m?.params.key).toEqual(['models', 'zaryth', 'body.glb'])
  })

  it('does not match a longer path against a shorter static route', () => {
    expect(matchRoute(compiled, '/api/save/extra')).toBeNull()
  })

  it('returns null for an unknown path so the caller can fall through to assets', () => {
    expect(matchRoute(compiled, '/index.html')).toBeNull()
    expect(matchRoute(compiled, '/api/nope')).toBeNull()
  })
})

describe('method dispatch', () => {
  const mod = {
    onRequestGet: () => new Response('get'),
    onRequestPost: () => new Response('post'),
  }

  it('picks the per-method export', () => {
    expect(handlerFor(mod, 'GET')).toBe(mod.onRequestGet)
    expect(handlerFor(mod, 'POST')).toBe(mod.onRequestPost)
  })

  it('has no handler for a method the module does not export', () => {
    expect(handlerFor(mod, 'DELETE')).toBeNull()
    expect(allowedMethods(mod).sort()).toEqual(['GET', 'POST'])
  })

  it('falls HEAD through to GET', () => {
    expect(handlerFor(mod, 'HEAD')).toBe(mod.onRequestGet)
  })

  it('lets a catch-all onRequest answer anything', () => {
    const any = { onRequest: () => new Response('any') }
    expect(handlerFor(any, 'PATCH')).toBe(any.onRequest)
    expect(allowedMethods(any)).toContain('DELETE')
  })
})

describe('middleware coverage — the §14 boundary', () => {
  it('wraps every /api route', () => {
    const apiRoutes = tableFiles.map(routePathForFile).filter((p: string) => p.startsWith('/api'))
    expect(apiRoutes.length).toBeGreaterThan(60)
    for (const path of apiRoutes) expect(hasMiddleware(path)).toBe(true)
  })

  it('leaves /admin and /.well-known bare, exactly as Pages did', () => {
    // functions/api/_middleware.js applied to /api/** only. Giving these CORS
    // now would be a silent behaviour change on the admin portal and the OAuth
    // discovery documents.
    expect(hasMiddleware('/admin')).toBe(false)
    expect(hasMiddleware('/.well-known/oauth-protected-resource')).toBe(false)
  })

  it('does not wrap a path that merely starts with the letters api', () => {
    expect(hasMiddleware('/apiary')).toBe(false)
  })

  it('installs the quest-gate bypass on a preview request it wraps', async () => {
    await apiMiddleware({
      request: new Request('https://preview.example.workers.dev/api/save'),
      env: { DISABLE_QUEST_REQUIREMENTS: 'true' },
      next: async () => new Response('ok'),
    })
    expect(questGatesDisabled()).toBe(true)
  })

  it('installs the FALSE answer just as reliably, so nothing inherits a stale true', () => {
    // §4: the bypass is per request. An isolate that skipped the install on a
    // non-qualifying request would keep answering with the previous request's
    // `true` — every quest gate open on production, from one preview call.
    setQuestGateBypass(true)
    expect(questGatesDisabled()).toBe(true)
    setQuestGateBypass(resolveQuestGateBypass({ DISABLE_QUEST_REQUIREMENTS: 'true' }, 'https://pocketrpg.co.uk/api/save'))
    expect(questGatesDisabled()).toBe(false)
  })

  it('runs the install before the preflight short-circuit', async () => {
    // An OPTIONS from an allowed native origin never reaches next(), so an
    // install placed after that branch would leave the isolate un-set.
    setQuestGateBypass(false)
    const res = await apiMiddleware({
      request: new Request('https://preview.example.workers.dev/api/save', {
        method: 'OPTIONS',
        headers: { Origin: 'capacitor://localhost' },
      }),
      env: { DISABLE_QUEST_REQUIREMENTS: 'true' },
      next: async () => { throw new Error('preflight must not reach the handler') },
    })
    expect(res.status).toBe(204)
    expect(questGatesDisabled()).toBe(true)
  })
})
