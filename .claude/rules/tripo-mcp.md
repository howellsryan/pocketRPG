---
paths:
  - "functions/api/tripo-mcp.js"
  - "functions/api/tripo-assets/**"
  - "functions/_lib/tripo/**"
  - "tests/tripoMcp.test.ts"
  - "scripts/tripo-worldmap.mjs"
  - "scripts/tripo-item-model.mjs"
  - "scripts/tripo-item-prompts.json"
---

# Tripo AI MCP bridge (`/api/tripo-mcp`)

Path-scoped rule — auto-loads when working on the Tripo bridge or its tests. See `CLAUDE.md` §15 for the pointer to the (unrelated) player-facing MCP server.

- **Not the game's MCP server.** `functions/api/mcp.js` (§15, `.claude/rules/mcp.md`) is player-facing, OAuth 2.1-gated, and forwards a player's own session token to real `/api/*` handlers. `functions/api/tripo-mcp.js` is a separate, unrelated stateless JSON-RPC server: a developer/content-pipeline tool that proxies Tripo AI's task API (`api.tripo3d.ai`) so an AI coding assistant can generate 3D models / concept art for the game without needing its own network egress to Tripo. It exists because Tripo's host is unreachable from network-restricted coding sandboxes; this Cloudflare Worker holds the Tripo key and has full egress.
- **Auth**: a single static bearer secret (`TRIPO_MCP_TOKEN`, `functions/_lib/tripo/auth.js`), compared via a SHA-256 constant-time check — not OAuth, not the session JWT. Never wire player identity or `requireAuth` into this file.
- **Tools** (`functions/_lib/tripo/schema.js` + `tools.js`): `create_task` / `get_task` mirror Tripo's submit-then-poll task API (see `scripts/tripo-worldmap.mjs`, the original local-only version of this workflow, for the same shape run by a human with `TRIPO_API_KEY` in their own env). `store_asset` downloads a URL from a finished task's output server-side and persists it to the `TRIPO_ASSETS` R2 bucket, returning a stable `/api/tripo-assets/<key>` URL (public — these are generated art/model files, not player data; keys default to random UUIDs, or pass `key` for a deliberate path like `models/<item>.v1.glb`). `get_asset` returns a stored asset's bytes as base64 (capped ~15 MiB per call; pass `offset`/`length` to chunk larger files). `upload_asset` is the write direction: base64 bytes → R2 under a chosen key (≤25 MiB decoded), so locally-processed GLBs get hosted without wrangler. The serving route is the catch-all `functions/api/tripo-assets/[[key]].js` (nested keys, immutable cache — never reuse a key, bump `vN`).
- **Adding a tool**: same three-file shape as the game's MCP (`schema.js` metadata, `tools.js` dispatch, a test in `tests/tripoMcp.test.ts`) — `tools.js` throws at import time if a schema name has no dispatch handler, so schema/dispatch can't drift silently.
- **Secrets**: `TRIPO_API_KEY` (Tripo platform key) and `TRIPO_MCP_TOKEN` (bearer secret for this endpoint) are separate Cloudflare secrets from everything the player-facing app uses — see `wrangler.toml`'s secret comments. Never commit either.
- **Equipment 3D models are hosted from R2, not the repo**: processed GLBs live at `models/<item>.vN.glb` and `src/data/equipmentModels.json` references `/api/tripo-assets/models/<item>.vN.glb` (site-relative, so each deployment serves its own environment's bucket — preview and production buckets are separate; a model uploaded via preview must be re-uploaded against production before the entry works there). `public/3d-samples/` remains for the hero + legacy samples.
- **Automation** (`scripts/tripo-item-model.mjs`, `npm run gen:item-model -- --item <id>`): the whole pipeline in one command — Tripo `text_to_model` (prompt from `--prompt` or the per-item preset in `scripts/tripo-item-prompts.json`) → poll → persist render (`renders/`) + raw GLB (`raw/`) to R2 → download → `scripts/process-3d-model.mjs` shrink → `upload_asset` to `models/<item>.vN.glb` → register in `equipmentModels.json`. Needs open egress to the deployment (`--base-url`, default preview; `TRIPO_MCP_TOKEN` env for auth), so it runs on a dev machine — a network-restricted coding session instead drives the same steps through the MCP tools (`get_asset` chunked reads for the raw GLB, `upload_asset` for the processed one), running `process-3d-model.mjs` locally. Afterwards: eyeball the stored render, tune the hand transform in `public/3d-preview.html`, run the commit gate, commit the registry change.
- 2D art still lands the same way as before this bridge existed: pick the best `rendered_image` output, save it under `public/world/` (or wherever the asset belongs), and wire it into `src/data/*.json` (e.g. `world.json`'s `mapImage`) — or keep it in R2 under a stable `images/...` key and reference the `/api/tripo-assets/` URL.
