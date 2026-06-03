// OAuth/MCP discovery documents. Pure builders keyed off the request origin so
// production and preview deployments each advertise their own URLs.

// RFC 8414 — Authorization Server Metadata.
export function authServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  }
}

// RFC 9728 — Protected Resource Metadata. The MCP endpoint is the resource;
// it points clients at this server as its authorization server.
export function protectedResourceMetadata(origin) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: ['mcp'],
    bearer_methods_supported: ['header'],
  }
}
