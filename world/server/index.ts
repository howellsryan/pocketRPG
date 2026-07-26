import { routePartykitRequest } from 'partyserver'
import { WorldZone } from './WorldZone'
import { CoopBossRoom } from './CoopBossRoom'
import { handleWorldSession } from './session'
import { handleEditorRequest } from './editor'
import type { Env } from './env'

// CoopBossRoom is reached only as a Durable Object, by the Pages app's
// /api/coop/* routes over a cross-script binding — this Worker exposes no HTTP
// route for it. It lives here because Pages projects cannot export DO classes,
// and this Worker already has the DO infrastructure and the same D1 binding.
export { WorldZone, CoopBossRoom }
export type { Env }

const EDITOR_PREFIX = '/api/world/editor'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/world/session' && request.method === 'POST') {
      return handleWorldSession(request, env)
    }

    if (url.pathname === EDITOR_PREFIX || url.pathname.startsWith(EDITOR_PREFIX + '/')) {
      return handleEditorRequest(request, env, url.pathname.slice(EDITOR_PREFIX.length))
    }

    const partyResponse = await routePartykitRequest(request, env as unknown as Record<string, unknown>)
    if (partyResponse) return partyResponse

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
