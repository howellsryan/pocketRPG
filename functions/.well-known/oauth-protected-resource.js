// RFC 9728 — OAuth 2.0 Protected Resource Metadata. The /api/mcp 401 response
// points clients here so they can discover which authorization server to use.

import { protectedResourceMetadata } from '../_lib/oauth/metadata.js'
import { getOrigin, oauthJson, OAUTH_CORS } from '../_lib/oauth/store.js'

export function onRequestGet({ request }) {
  return oauthJson(protectedResourceMetadata(getOrigin(request)))
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: OAUTH_CORS })
}
