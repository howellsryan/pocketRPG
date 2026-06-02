/// <reference types="@cloudflare/workers-types" />

// Bindings available to the worker. DB + JWT_SECRET are shared with the main
// Pages project; OAUTH_KV + MCP_OBJECT are MCP-server-local infrastructure.
export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;

  // Injected into the OAuth *default handler*'s env by workers-oauth-provider.
  OAUTH_PROVIDER: {
    parseAuthRequest(request: Request): Promise<AuthRequest>;
    completeAuthorization(opts: {
      request: AuthRequest;
      userId: string;
      scope: string[];
      metadata?: Record<string, unknown>;
      props: Record<string, unknown>;
    }): Promise<{ redirectTo: string }>;
  };

  JWT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  APP_BASE_URL: string;
}

export interface AuthRequest {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  [key: string]: unknown;
}

// The authenticated PocketRPG identity, carried on the MCP session after the
// OAuth handshake completes (set as `props` in completeAuthorization).
export interface Props extends Record<string, unknown> {
  identityId: number | string;
  provider: "github" | "google";
  displayName: string;
}

// Shape passed to the bundled Pages Function handlers.
export interface Identity {
  id: number | string;
  provider: string;
  displayName: string;
}
