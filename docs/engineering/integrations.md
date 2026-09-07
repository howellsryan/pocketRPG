# Integrations contributor reference

Read for changes in this domain. Code paths are repository-relative; numbered
sections and cross-references use the stable numbering in AGENTS.md. Explicitly
read applicable .claude/rules files when the host does not load them.

## 15) MCP Server (`/api/mcp`)
Stateless MCP server (JSON-RPC 2.0) at `functions/api/mcp.js` with its own OAuth 2.1 server. Architecture + how-to-add-a-tool (bridge tools vs save-intents, the `schema.js`/`tools.js`/test trio, `applyTaskResult.js` as single source of truth) live in path-scoped rule **`.claude/rules/mcp.md`** (Claude hosts may auto-load on `functions/api/mcp.js`, `functions/_lib/mcp/**`, OAuth paths, `src/screens/OAuthConsentScreen.jsx`, `tests/mcp*.test.ts`).

## 16) Help Chatbot (`/api/chat`)
In-game helper (floating 💬) that answers questions **and performs account actions** via the MCP tool surface. Full architecture (model fallback chain, progressive tool exposure, HMAC-gated writes + 1-credit action fee, daily message/spend budgets, knowledge index) lives in path-scoped rule **`.claude/rules/chat.md`** (Claude hosts may auto-load on `functions/api/chat.js`, `functions/_lib/chat/**`, `src/components/ChatWidget.jsx`, `docs/game-guide.md`). Player-visible mechanics change → update `docs/game-guide.md` + `npm run gen:knowledge` + commit.

