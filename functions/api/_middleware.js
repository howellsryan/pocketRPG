// Applies to every /api/* route. Answers CORS preflights and decorates
// responses to allowed native origins. Same-origin (web) requests pass through
// untouched because corsHeaders() returns nothing for them.
import { corsHeaders, isAllowedOrigin } from '../_lib/cors.js'
import { setQuestGateBypass, resolveQuestGateBypass } from '../../src/engine/questGates.js'

export async function onRequest(context) {
  const { request, next, env } = context
  const origin = request.headers.get('Origin')

  // Installed on EVERY request, including the ones that resolve to false, so a
  // request that does not qualify can never inherit an earlier `true` from the
  // isolate. Preview-only by construction — see questGates.js for both locks.
  setQuestGateBypass(resolveQuestGateBypass(env, request.url))

  if (request.method === 'OPTIONS' && isAllowedOrigin(origin)) {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  const response = await next()
  if (!isAllowedOrigin(origin)) return response

  // A WebSocket upgrade (coop/raid sockets, §20) cannot be rewrapped: the
  // Response() constructor rejects any status outside 200-599, so this throws
  // for 101 specifically — and reconstructing would drop the runtime's
  // `.webSocket` handle the upgrade rides on even if it didn't. The browser's
  // WebSocket constructor doesn't consult CORS the way fetch() does (the
  // ticket in the URL is what authenticates it, per socket.js), so passing the
  // room's own 101 straight through is correct, not merely expedient.
  if (response.status === 101) return response

  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
