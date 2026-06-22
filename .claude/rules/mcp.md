---
paths:
  - "functions/api/mcp.js"
  - "functions/_lib/mcp/**"
  - "functions/_lib/oauth/**"
  - "functions/api/oauth/**"
  - "functions/.well-known/**"
  - "src/screens/OAuthConsentScreen.jsx"
  - "tests/mcp*.test.ts"
---

# MCP Server (`/api/mcp`)

Path-scoped rule — auto-loads when working on the MCP server, its OAuth authorization server, or MCP tests. See `CLAUDE.md` §15 for the pointer.

- A stateless MCP (Model Context Protocol) server lives in the Pages app at `functions/api/mcp.js` (JSON-RPC 2.0 over POST). It lets AI assistants view characters and run server-authoritative actions, and serves context via `instructions` + resources (`functions/_lib/mcp/reference.js`). Roadmap: `docs/mcp-roadmap.md`; gap-closure: `docs/mcp-gap-plan.md`.
- Tools never duplicate game logic: each `tools/call` forwards the caller's bearer token to the matching `/api/*` handler via `functions/_lib/mcp/bridge.js`, so all auth/locks/audit run in the existing endpoints. Adding a tool = add it to `functions/_lib/mcp/schema.js` (metadata) and `functions/_lib/mcp/tools.js` (dispatch).
- Auth is **OAuth 2.1** (PKCE + Dynamic Client Registration), tailored for ChatGPT custom connectors. PocketRPG is its own authorization server (`functions/api/oauth/**`, `functions/.well-known/**`, `functions/_lib/oauth/**`, migration `0022`); the issued access token is the normal session JWT, verified by `requireAuth` like every other route. The in-app consent screen is `src/screens/OAuthConsentScreen.jsx` (reached via `/?oauth=…`, must stay **out** of `GAME_CHUNK_FILES`). No new secrets — reuses `JWT_SECRET`.

## MCP extension rule (how to add or change a tool)
1. **Default to a bridge tool** — import the real `/api/*` handler and call it via `callHandler` in `tools.js`. API changes (auth, locks, audit, validation) propagate for free; nothing in `intents.js` needs to change.
2. **Use a save-intent only when no endpoint exists** — write a pure function in `functions/_lib/mcp/intents.js` that mutates the decoded save object in place and throws `GameApiError` on bad input. Intents **must** reuse shared `src/engine` helpers (especially `applyTaskResult` from `src/engine/applyTaskResult.js` for any idle-sim result) — never re-code reward application.
3. **Adding a tool always requires three files**: `schema.js` (metadata + JSON Schema input), `tools.js` (dispatch handler), and a test in `tests/mcpIntents.test.ts` or `tests/mcpServer.test.ts`. The parity test in `tests/mcpServer.test.ts` ("every advertised tool has a dispatch handler") enforces schema ↔ dispatch lockstep.
4. **`src/engine/applyTaskResult.js` is the single source of truth** for applying idle simulation results (XP, bank, inventory, HP, ammo/charges, dungeoneeringTokens) to a save. Both the MCP (`intents.js`) and the browser (`gameState.jsx`) import it. Never copy-paste this logic — extend the shared module.
- Keep scope to three kinds of action: reads, server-authoritative bridge tools (the legitimate grant/spend paths), and *constrained* save intents — pure, validated mutations that reuse `src/engine` helpers. Never expose a raw/arbitrary save write: anything that grants a high-value unique or spends credits/points must go through its existing endpoint, not an intent. See `docs/mcp-roadmap.md` for the shipped surface and the deliberately-excluded set.
