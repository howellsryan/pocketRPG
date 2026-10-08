// The single Worker: site, API, and both Durable Object classes.
//
// It replaces a Pages project whose Functions could not export a DO class, so
// CoopBossRoom had to live in a second Worker and be bound cross-script. That
// binding is what made co-op and raids need two deploys, and a stale world
// Worker settled every raid kill against the first boss's drop table — a
// server-granted economy bug whose only cause was deploy skew. Both classes are
// local exports here, so that whole category is gone; don't reintroduce a split
// (CoopBossRoom is called only from /api/coop/*, so moving it back out puts a
// network hop between a route and the object it drives).
import { routePartykitRequest } from 'partyserver'
import { ROUTE_MODULES } from './routes.js'
import {
  compileRoutes,
  routePathForFile,
  matchRoute,
  handlerFor,
  allowedMethods,
  hasMiddleware,
} from './router.js'
import { isWorldHost, rewriteForWorldHost } from './worldHost.js'
import { onRequest as apiMiddleware } from '../functions/api/_middleware.js'
import { setQuestGateBypass, resolveQuestGateBypass } from '../src/engine/questGates.js'
import { handleWorldSession } from '../world/server/session'
import { handleWorldLeave } from '../world/server/leave'
import { handlePvpCount } from '../world/server/pvpCount'
import { handleEditorRequest } from '../world/server/editor'
import { departInRoom } from '../world/server/departInRoom'
import { worldAccessEnabled } from '../src/engine/worldAccess.js'

export { WorldZone } from '../world/server/WorldZone'
export { CoopBossRoom } from '../world/server/CoopBossRoom'

const ROUTES = compileRoutes(
  ROUTE_MODULES.map(({ file, module }) => ({ path: routePathForFile(file), module }))
)

const EDITOR_PREFIX = '/api/world/editor'

function isWorldRequest(url) {
  // Match the router's repeated/trailing slash handling before dispatch.
  const path = '/' + url.pathname.split('/').filter(Boolean).join('/')
  return isWorldHost(url.hostname)
    || path === '/world' || path.startsWith('/world/')
    || path === '/api/world-token'
    || path === '/api/world' || path.startsWith('/api/world/')
    || path === '/parties/world-zone' || path.startsWith('/parties/world-zone/')
}

/** The world Worker's own HTTP surface, which never went through Pages and so
 * never had the /api/** middleware. Kept off it here for the same reason: the
 * editor answers its own CORS and pvp-count is deliberately CORS-open. */
async function worldApiResponse(request, env, url) {
  if (url.pathname === '/api/world/session' && request.method === 'POST') {
    return handleWorldSession(request, env)
  }
  if (url.pathname === '/api/world/leave' && request.method === 'POST') {
    return handleWorldLeave(request, env, departInRoom)
  }
  if (url.pathname === '/api/world/pvp-count') {
    return handlePvpCount(request, env)
  }
  if (url.pathname === EDITOR_PREFIX || url.pathname.startsWith(EDITOR_PREFIX + '/')) {
    return handleEditorRequest(request, env, url.pathname.slice(EDITOR_PREFIX.length))
  }
  return null
}

async function dispatch(request, env, ctx, url) {
  const matched = matchRoute(ROUTES, url.pathname)
  if (!matched) return null

  const { route, params } = matched
  const handler = handlerFor(route.module, request.method)
  if (!handler) {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: allowedMethods(route.module).join(', ') },
    })
  }

  const context = {
    request,
    env,
    params,
    waitUntil: (promise) => ctx.waitUntil(promise),
    data: {},
  }
  const response = await handler(context)
  if (request.method === 'HEAD') {
    return new Response(null, { status: response.status, headers: response.headers })
  }
  return response
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // Installed for EVERY request, before any routing decision, because the
    // world's own routes and the partyserver upgrade are answered ahead of the
    // /api middleware that installs it for the game API — and under Pages those
    // routes lived in a Worker whose fetch did exactly this. The `false` case
    // matters as much as the `true` one: an isolate that skipped the install
    // would inherit the previous request's answer (§4).
    setQuestGateBypass(resolveQuestGateBypass(env, request.url))

    try {
      // Exit-only cleanup stays authenticated and releases existing save locks.
      const departing = url.pathname === '/api/world/leave' && request.method === 'POST'
      if (!departing && isWorldRequest(url) && !worldAccessEnabled(env, request.url)) {
        return new Response(JSON.stringify({ error: 'World unavailable' }), {
          status: 404, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        })
      }
      const worldResponse = await worldApiResponse(request, env, url)
      if (worldResponse) return worldResponse

      // The upgrade the world client opens against WorldZone. Gated on NOT
      // being an API path so partyserver's own path shape can never shadow a
      // route — under Pages the two lived in different Workers and could not
      // reach each other, and that separation has to survive the merge.
      if (!hasMiddleware(url.pathname)) {
        const party = await routePartykitRequest(request, env)
        if (party) return party
      }

      // Falls through to the assets INSIDE the middleware, not around it: under
      // Pages an /api path with no function reached the asset server via
      // next(), so the 404 it produced still carried the CORS decoration. A
      // next() that resolved to nothing would throw here instead.
      const run = async () =>
        (await dispatch(request, env, ctx, url)) ?? env.ASSETS.fetch(rewriteForWorldHost(request, url))

      if (hasMiddleware(url.pathname)) {
        return await apiMiddleware({
          request,
          env,
          next: run,
          waitUntil: (promise) => ctx.waitUntil(promise),
        })
      }
      return await run()
    } catch (err) {
      console.error('[PocketRPG][worker] unhandled', {
        path: url.pathname,
        method: request.method,
        message: (err && (err.message || String(err))) || 'unknown',
      })
      return new Response('Internal Server Error', { status: 500 })
    }
  },
}
