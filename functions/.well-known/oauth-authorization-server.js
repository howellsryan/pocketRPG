// RFC 8414 — OAuth 2.0 Authorization Server Metadata.
// MCP clients fetch this from {issuer}/.well-known/oauth-authorization-server
// to discover the authorize/token/registration endpoints.

import { authServerMetadata } from '../_lib/oauth/metadata.js'
import { getOrigin, oauthJson, OAUTH_CORS } from '../_lib/oauth/store.js'

export function onRequestGet({ request }) {
  return oauthJson(authServerMetadata(getOrigin(request)))
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: OAUTH_CORS })
}
