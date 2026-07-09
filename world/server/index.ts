import { routePartykitRequest } from 'partyserver'
import { WorldZone } from './WorldZone'
import { handleWorldSession } from './session'
import type { Env } from './env'

export { WorldZone }
export type { Env }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/world/session' && request.method === 'POST') {
      return handleWorldSession(request, env)
    }

    const partyResponse = await routePartykitRequest(request, env as unknown as Record<string, unknown>)
    if (partyResponse) return partyResponse

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
