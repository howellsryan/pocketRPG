# PocketRPG MCP Server

A **remote [MCP](https://modelcontextprotocol.io) server** that exposes PocketRPG
to MCP clients (ChatGPT, Claude, Cursor, …). It runs as a **standalone
Cloudflare Worker** that **shares the production D1 database** with the main
Pages app, so it reads and writes the same characters, saves and identities.

It is deliberately a thin shim: each tool authenticates the caller, then
invokes the **same `functions/api/*` handler** the website uses (via
[`src/api-bridge.ts`](src/api-bridge.ts)) against the shared `DB` binding. All
game logic — ownership checks, PvP inventory locks, save-revision bookkeeping,
audit logging — runs in the unchanged production code. No logic is duplicated.

## Scope (Option A: read + server-authoritative actions)

This server exposes the parts of PocketRPG that are **server-authoritative**, so
an external agent can manage an account safely. It does **not** simulate the
client-side game loop (live combat / idle XP / drops), which by design is
computed on the client and persisted through `PUT /api/save`. Letting an MCP
client write arbitrary saves would mean handing it the client-authoritative
trust the browser has — out of scope for v1.

### Tools

| Tool | Wraps | Notes |
|------|-------|-------|
| `list_characters` | `GET /api/characters` | |
| `get_account` | `GET /api/auth/me` | identity + credits |
| `get_character_state` | `GET /api/save` | summarised: coins, skill levels, gear, inventory |
| `get_collection_log` | `GET /api/collection-log` | |
| `get_kill_counts` | `GET /api/kill-counts` | |
| `get_leaderboard` | `GET /api/leaderboard` | public; `total` or `kc` |
| `buy_item` | `POST /api/purchase` | debits coins, grants item server-side |
| `skip_hour` | `POST /api/skip-hour` | debits credits |
| `skip_slayer_task` | `POST /api/slayer/skip` | debits 1 credit |

Tools that act on a character take an optional `character_id`; if the account
has exactly one character it is auto-selected.

## Architecture

```
MCP client ──HTTP──▶ Cloudflare Worker (pocketrpg-mcp)
                     │
                     ├─ @cloudflare/workers-oauth-provider
                     │     /authorize ─▶ AuthHandler (Hono) ─▶ GitHub/Google OAuth
                     │     /token /register, token store in OAUTH_KV
                     │
                     ├─ McpAgent (Durable Object MCP_OBJECT)  /mcp, /sse
                     │     tools ─▶ api-bridge ─▶ functions/api/*.js handlers
                     │
                     └─ DB  ── shared D1 (same database_id as the Pages app)
```

The bundle imports the production handlers directly (`../../functions/...`) and
the XP table (`../../src/engine/experience.js`), so the worker must be deployed
from within this repo.

## Deploy

Prerequisites: a Cloudflare account with the existing `pocketrpg` D1 database,
and `wrangler` authenticated (`npx wrangler login`).

```bash
cd mcp
npm install

# 1) Create the KV namespace for OAuth grants, then paste the id into
#    wrangler.jsonc (kv_namespaces[0].id).
npx wrangler kv namespace create OAUTH_KV

# 2) Set secrets (production).
npx wrangler secret put JWT_SECRET            # SAME value as the Pages project
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

# 3) Deploy.
npx wrangler deploy
```

Optionally map a custom domain (e.g. `mcp.pocketrpg.co.uk`) to the worker in the
Cloudflare dashboard → Workers → Custom Domains. The examples below assume
`https://mcp.pocketrpg.co.uk`.

> **`JWT_SECRET` must match the Pages project exactly.** The worker mints a
> short-lived session token for each tool call that the bundled handlers verify
> with `verifyJWT`. A mismatched secret fails every authenticated tool with
> `401`.

### OAuth app setup

The worker runs the GitHub/Google OAuth dance itself, so the provider must allow
the worker's callback URL:

- **GitHub:** the OAuth app's *Authorization callback URL* must match the
  worker host. GitHub matches by host, so a worker on a different subdomain than
  `pocketrpg.co.uk` needs the callback `https://mcp.pocketrpg.co.uk/callback/github`.
  Either add it to a **dedicated MCP OAuth app** (recommended) or to an app whose
  host already matches.
- **Google:** add `https://mcp.pocketrpg.co.uk/callback/google` to the OAuth 2.0
  client's *Authorized redirect URIs*.

Using a **dedicated** OAuth app is fine — identity is keyed on
`(provider, provider_user_id)`, and the provider's user id is stable across
apps, so a user signing in through the MCP app resolves to the **same** PocketRPG
account they use on the website.

## Connect a client

The server URL is `https://mcp.pocketrpg.co.uk/mcp` (Streamable HTTP). Legacy
SSE clients can use `/sse`.

- **ChatGPT:** Settings → Connectors → add a custom connector with the `/mcp`
  URL. ChatGPT runs the OAuth flow in-browser; sign in with GitHub/Google and
  approve. (Custom connectors require a paid plan / Developer mode.)
- **Claude (Desktop/web):** Settings → Connectors → Add custom connector → paste
  the `/mcp` URL → authorise.
- **Cursor / other MCP hosts:** add the same remote URL.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in the values
npm run dev                      # wrangler dev (binds to the prod D1 by default)
```

`wrangler dev` talks to the real remote D1 unless you pass `--local`. Local
OAuth requires the provider callback URL to point at your dev host
(`http://localhost:8787/callback/<provider>`); register that on a test OAuth app.

You can smoke-test the transport with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
# connect to http://localhost:8787/mcp
```

## Roadmap (Option B and beyond)

- **Actual gameplay** (train a skill, fight a boss) requires running the
  client engine (`src/engine/`) server-side as compute-and-persist tools — a
  larger change that partially shifts the client-authoritative model.
- PvP (waiting room / invitations / match), trading post, and the
  nonce-protected action-completion endpoints can be added as further tools.
