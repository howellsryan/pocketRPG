// Applies to every /api/* route. Answers CORS preflights and decorates
// responses to allowed native origins. Same-origin (web) requests pass through
// untouched because corsHeaders() returns nothing for them.
import { corsHeaders, isAllowedOrigin } from '../_lib/cors.js'

export async function onRequest(context) {
  const { request, next } = context
  const origin = request.headers.get('Origin')

  if (request.method === 'OPTIONS' && isAllowedOrigin(origin)) {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  const response = await next()
  if (!isAllowedOrigin(origin)) return response

  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
