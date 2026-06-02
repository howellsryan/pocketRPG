# PocketRPG MCP server

PocketRPG exposes a [Model Context Protocol](https://modelcontextprotocol.io)
server so AI assistants (ChatGPT first) can view characters and run
shop/credit actions on a player's behalf.

It is **not** a separate service — it lives inside the existing Cloudflare Pages
app as Pages Functions, reusing the same D1 database, the same session-token
verification, and the same `/api/*` handlers.

- MCP endpoint: `https://pocketrpg.co.uk/api/mcp`
- Transport: MCP Streamable HTTP, **stateless** (JSON-RPC 2.0 over `POST`).
- Auth: **OAuth 2.1** (PKCE + Dynamic Client Registration). PocketRPG is its own
  authorization server; the access token issued is the standard PocketRPG
  session JWT.

## Why OAuth (and not a pasted token)

ChatGPT's custom connectors drive an OAuth flow: they auto-discover the
authorization server, register themselves, send the user through an approval
screen, and exchange a code for a token. So the first-pass design targets that
flow end-to-end. There is **no token for the user to copy** — they just approve
in the browser. No new secrets are required (it reuses `JWT_SECRET`); the only
new persistence is two small D1 tables (migration `0022`).

## End-to-end flow

1. ChatGPT POSTs to `/api/mcp` with no token → **401** with
   `WWW-Authenticate: Bearer … resource_metadata="…/.well-known/oauth-protected-resource"`.
2. ChatGPT fetches `/.well-known/oauth-protected-resource` (RFC 9728) →
   `/.well-known/oauth-authorization-server` (RFC 8414) to discover endpoints.
3. **Dynamic Client Registration** (RFC 7591): `POST /api/oauth/register` with
   the client's `redirect_uris` → returns a `client_id` (public client, PKCE, no
   secret). Stored in `oauth_clients`.
4. **Authorize**: browser hits `GET /api/oauth/authorize` (validates client +
   redirect_uri + PKCE `S256`), which mints a short-lived signed *request token*
   and redirects to the in-app consent screen at `/?oauth=<request_token>`.
5. **Consent** (`src/screens/OAuthConsentScreen.jsx`): the user signs in with the
   existing GitHub/Google login if needed, then chooses Allow/Deny. Allow →
   `POST /api/oauth/approve` (with their session JWT) issues a one-time
   authorization code (`oauth_codes`) and returns the redirect back to ChatGPT.
6. **Token**: `POST /api/oauth/token` exchanges the code + `code_verifier`
   (PKCE check, single-use) for an access token = a 30-day PocketRPG JWT.
7. ChatGPT calls `/api/mcp` with `Authorization: Bearer <jwt>`; the same
   `requireAuth` used by every `/api/*` route verifies it.

### Server pieces

| Path | Purpose |
|------|---------|
| `functions/api/mcp.js` | JSON-RPC MCP endpoint; 401 + metadata pointer when unauthenticated |
| `functions/.well-known/oauth-authorization-server.js` | AS metadata (RFC 8414) |
| `functions/.well-known/oauth-protected-resource.js` | Resource metadata (RFC 9728) |
| `functions/api/oauth/register.js` | Dynamic Client Registration (RFC 7591) |
| `functions/api/oauth/authorize.js` | Authorization endpoint → consent hand-off |
| `functions/api/oauth/approve.js` | Consent decision → issues auth code |
| `functions/api/oauth/token.js` | Code → access token (PKCE verified) |
| `functions/_lib/oauth/*` | PKCE, metadata builders, D1 store, token helpers |
| `migrations/0022_oauth_clients_and_codes.sql` | `oauth_clients`, `oauth_codes` |

## Tools

Each `tools/call` forwards the caller's bearer token to the matching production
handler (`functions/_lib/mcp/bridge.js`), so all auth/locks/audit run in the
existing endpoints — no duplicated game logic.

| Tool | Wraps |
|------|-------|
| `list_characters` | `GET /api/characters` |
| `get_account` | `GET /api/auth/me` |
| `get_character_state` | `GET /api/save` (summarised) |
| `get_collection_log` | `GET /api/collection-log` |
| `get_kill_counts` | `GET /api/kill-counts` |
| `get_leaderboard` | `GET /api/leaderboard` |
| `buy_item` | `POST /api/purchase` |
| `skip_hour` | `POST /api/skip-hour` |
| `skip_slayer_task` | `POST /api/slayer/skip` |

Scope is the **server-authoritative** slice. It does not simulate the
client-side game loop (live combat / idle XP / drops), so it never exposes raw
save writes.

## Connecting from ChatGPT

In-game: Home → the scroll icon ("Connect an AI assistant") shows the MCP URL
and the steps. In ChatGPT: Settings → Connectors → Add custom connector → paste
`https://pocketrpg.co.uk/api/mcp` → Connect → approve in the PocketRPG window.

## Deploying

- Apply the migration to the bound D1 (prod + preview), e.g.
  `wrangler d1 migrations apply pocketrpg`.
- No new secrets or bindings. `JWT_SECRET` and the `DB` binding already exist.

## Testing

- `tests/oauthServer.test.ts` — PKCE (incl. the RFC 7636 vector) + discovery
  metadata.
- `tests/mcpServer.test.ts` — `summarizeSave` + tool schema.
- The reused endpoint handlers keep their own endpoint tests.
- End-to-end: deploy a Pages preview and connect with the MCP Inspector
  (`npx @modelcontextprotocol/inspector`) using its OAuth option, or ChatGPT.

## Roadmap

- Other clients (Claude, Cursor) follow the same OAuth discovery, so they should
  work against the same endpoints.
- PvP / trading-post / action-completion tools can be added later.
