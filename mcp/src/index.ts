// PocketRPG remote MCP server entrypoint.
//
// workers-oauth-provider is the top-level handler. It:
//   * serves the OAuth endpoints (/authorize delegated to AuthHandler,
//     plus /token, /register) and stores grants in OAUTH_KV;
//   * gates the MCP transport endpoints (/mcp Streamable HTTP, /sse legacy SSE)
//     behind a valid bearer token, injecting the authenticated identity as
//     `props` on the McpAgent session.

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { PocketRpgMCP } from "./mcp";
import { AuthHandler } from "./auth/handler";

export default new OAuthProvider({
  apiHandlers: {
    "/mcp": PocketRpgMCP.serve("/mcp"),
    "/sse": PocketRpgMCP.serveSSE("/sse"),
  },
  // @ts-expect-error Hono app satisfies the ExportedHandler fetch contract.
  defaultHandler: AuthHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

// The Durable Object class must be exported for the binding in wrangler.jsonc.
export { PocketRpgMCP };
