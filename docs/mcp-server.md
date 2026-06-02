# PocketRPG MCP server

PocketRPG exposes a [Model Context Protocol](https://modelcontextprotocol.io)
server so AI assistants (ChatGPT, Claude, Cursor, …) can view characters and run
shop/credit actions on a player's behalf.

It is **not** a separate service — it lives inside the existing Cloudflare Pages
app as a single Pages Function at **`/api/mcp`**, so it reuses the same D1
database, the same session-token verification, and the same `/api/*` handlers.
No extra worker, Durable Object, KV namespace, or new secret is required.

- Endpoint: `https://pocketrpg.co.uk/api/mcp`
- Transport: MCP Streamable HTTP, **stateless** (JSON-RPC 2.0 over `POST`).
- Auth: **bearer token** — the player's existing PocketRPG session token.

## How it works

`functions/api/mcp.js` answers the JSON-RPC methods `initialize`, `tools/list`,
`tools/call` and `ping`. Each `tools/call` is dispatched in
`functions/_lib/mcp/tools.js`, which **invokes the same production handler** the
web app uses (via `functions/_lib/mcp/bridge.js`), forwarding the caller's
`Authorization` header. The real handler runs its own auth, ownership checks,
PvP inventory lock, save-revision bookkeeping and audit logging — so there is no
duplicated game logic and the MCP layer never touches the JWT secret.

### Tools

| Tool | Wraps | Auth |
|------|-------|------|
| `list_characters` | `GET /api/characters` | required |
| `get_account` | `GET /api/auth/me` | required |
| `get_character_state` | `GET /api/save` (summarised) | required |
| `get_collection_log` | `GET /api/collection-log` | required |
| `get_kill_counts` | `GET /api/kill-counts` | required |
| `get_leaderboard` | `GET /api/leaderboard` | public |
| `buy_item` | `POST /api/purchase` | required |
| `skip_hour` | `POST /api/skip-hour` | required |
| `skip_slayer_task` | `POST /api/slayer/skip` | required |

Tools that act on a character take an optional `character_id`; if the account
has exactly one character it is auto-selected.

### Scope

This is the **server-authoritative** slice — safe for an external agent to
drive. It deliberately does **not** simulate the client-side game loop (live
combat / idle XP / drops), which PocketRPG computes on the client and persists
through `PUT /api/save`. Exposing arbitrary save writes would hand a client the
trust the browser has; that's out of scope for v1.

## Authentication (token-paste)

Players get their token in-game: **Home → the scroll icon ("Connect an AI
assistant")**, which shows the server URL and their session token with copy
buttons.

- The token is a signed JWT that **expires ~30 days after the last sign-in**.
- A **fresh token is minted on every login**; logging out and back in
  effectively rotates it (the old one keeps working until it expires).
- The token grants account access through the tools above — treat it like a
  password.

## Connecting a client

1. Copy the **server URL** (`https://pocketrpg.co.uk/api/mcp`) and your **token**
   from the in-game dialog.
2. Add a custom MCP server / connector in your assistant and configure
   bearer-token auth with the token:
   - **Claude Desktop / `mcp-remote`:** point at the URL with an
     `Authorization: Bearer <token>` header.
   - **MCP Inspector:** `npx @modelcontextprotocol/inspector`, connect to the
     URL, set the bearer token.
   - **ChatGPT / Cursor / others:** add the URL as a custom MCP server and supply
     the token where the client asks for an auth header / API key.

> Hosted clients differ in how they accept credentials. Token-paste works
> wherever a custom bearer/header can be set. A full OAuth "click to connect"
> flow can be layered on later if a target client requires it.

## Testing locally

`tests/mcpServer.test.ts` covers the pure pieces (`summarizeSave`, the tool
schema). The reused endpoint handlers are covered by their own endpoint tests.
End-to-end, smoke-test against a deployed Pages preview with the MCP Inspector.

## Roadmap

- PvP, trading post, and the nonce-protected action-completion endpoints can be
  added as further tools.
- Actual gameplay (train a skill, fight a boss) would require running the
  client engine server-side — a larger change that shifts the
  client-authoritative model.
