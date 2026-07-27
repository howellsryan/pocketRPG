import { getServerByName, routePartykitRequest } from 'partyserver'
import { WorldZone } from './WorldZone'
import { CoopBossRoom } from './CoopBossRoom'
import { PvpMatchRoom } from './PvpMatchRoom'
import { handleWorldSession } from './session'
import { handleWorldLeave, type DepartInRoom } from './leave'
import { handleEditorRequest } from './editor'
import { setQuestGateBypass, resolveQuestGateBypass } from '../../src/engine/questGates.js'
import type { Env } from './env'

// CoopBossRoom and PvpMatchRoom are reached only as Durable Objects, by the
// Pages app's /api/coop/* and /api/pvp/* routes over cross-script bindings —
// this Worker exposes no HTTP route for either. They live here because Pages
// projects cannot export DO classes, and this Worker already has the DO
// infrastructure and the same D1 binding.
export { WorldZone, CoopBossRoom, PvpMatchRoom }
export type { Env }

const EDITOR_PREFIX = '/api/world/editor'

/** Durable Object side of the exit beacon: hand the departure to the room the
 * beacon named. Lives here rather than in leave.ts so that module (and its
 * tests) stay free of the `cloudflare:workers` runtime import. */
const departInRoom: DepartInRoom = async (env, room, charId) => {
  const stub = await getServerByName<Env, WorldZone>(
    env.WorldZone as unknown as DurableObjectNamespace<WorldZone>,
    room
  )
  return await stub.departCharacter(charId)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Preview-only quest-gate bypass, installed per request (false included) so
    // the equip gates this Worker shares with the client agree with it. Both
    // production locks live in questGates.js.
    setQuestGateBypass(resolveQuestGateBypass(env, request.url))

    if (url.pathname === '/api/world/session' && request.method === 'POST') {
      return handleWorldSession(request, env)
    }

    // Exit beacon from a closing tab — see server/leave.ts. Plain HTTP rather
    // than a socket frame precisely because the socket may already be gone.
    if (url.pathname === '/api/world/leave' && request.method === 'POST') {
      return handleWorldLeave(request, env, departInRoom)
    }

    if (url.pathname === EDITOR_PREFIX || url.pathname.startsWith(EDITOR_PREFIX + '/')) {
      return handleEditorRequest(request, env, url.pathname.slice(EDITOR_PREFIX.length))
    }

    const partyResponse = await routePartykitRequest(request, env as unknown as Record<string, unknown>)
    if (partyResponse) return partyResponse

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
