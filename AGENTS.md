# PocketRPG contributor contract

## 0) Orientation
PocketRPG is a mobile-first, tick-based idle fantasy RPG. The client runs the
local loop; the server owns accounts, high-value grants and competitive/social
systems (§14). Edit source, never generated output. Pass the §11 commit gate.

This is the canonical contributor guide; CLAUDE.md is a compatibility pointer.
Legacy CLAUDE.md section references map to the same numbered sections here.
Read each routed reference before changing that domain, including cross-domain
callers. Paths in references are repository-relative. Claude path rules are not
assumed to auto-load in Codex, ChatGPT or GitHub-only sessions: read matching
`.claude/rules/*.md` explicitly. The complete scope map is in [SKILLS.md](SKILLS.md).

## 1) Snapshot
- Idle/sim fantasy RPG with OSRS-style combat/skilling (PocketRPG-owned fantasy naming).
- Tick: 600ms (`TICK_MS = 600`). Goals: mobile-first UI, low-latency local play, deterministic core. Requires an account + server connectivity (auth, characters, rewards, PvP, payments all server-side).
- Hosting: **one Cloudflare Worker** (`pocketrpg-app`, `wrangler.jsonc`) serving the site, the API and both Durable Object classes. `worker/index.js` is the entry; assets are staged into `dist_site/` by `scripts/stage-site.mjs`.

## 2) Tech Stack
- **UI**: Preact + JSX (no React). Reuse `src/components/`.
- **Styling**: Tailwind v4 compiled from `src/index.css` (`@import "tailwindcss"`) by `build_single.cjs` via Tailwind CLI — not a CDN. Tokens are CSS variables in `:root`. Fonts self-hosted via `@fontsource` (latin subset).
- **Client persistence**: IndexedDB (`idb`) + `localStorage`.
- **Server**: handlers in `functions/` (Pages-style `onRequest*` exports, dispatched by `worker/router.js` — add a file, run `npm run gen:routes`) over **D1** (SQLite, binding `DB`, schema in `migrations/*.sql`). Auth is a session **JWT** (`JWT_SECRET`) via GitHub/Google OAuth; PocketRPG is also its own **OAuth 2.1** server for MCP (§15). Payments via **Stripe** Checkout (`functions/api/stripe/`).
- **Build**: Vite + TS transpile, then single-file concat (`build_single.cjs`). **Mobile**: Capacitor/iOS (`npm run build:app`). **Tests**: Vitest, logic-only (`tests/**/*.test.ts`).

## 3) Repository Layout
**Client `src/`** — `src/engine/` is pure logic, **no UI imports**:
- `engine/` deterministic logic (combat, XP, idle sim, loot) · `screens/` top-level UI · `components/` shared UI · `state/` Preact context/wiring (`gameState.jsx`) · `hooks/` Preact hooks · `cloud/` cloud sync + `/api` client · `db/` IndexedDB · `data/` static JSON content (**immutable**) · `utils/` shared helpers (`helpers.js`, prefer over redefining — §12).

**Server `functions/`** — HTTP handlers, routed by `worker/`:
- `api/**` HTTP endpoints (`/api/save`, `/api/actions/**`, `/api/coop/**`, `/api/purchase`, `/api/mcp`, `oauth/**`, `stripe/**`) · `_lib/**` shared libs (`mcp/`, `oauth/`, `game/`, `character.js`, `jwt.js`) · `.well-known/**` OAuth discovery.

**Other**: `migrations/` D1 SQL (`NNNN_name.sql`) · `tests/**/*.test.ts` Vitest · `scripts/` build/seed/maintenance · `docs/` design plans.

## 4) Gameplay Invariants
Read [the gameplay reference](docs/engineering/gameplay.md) for this section
and its applicable path rules before changing the domain.

## 5) XP & Leveling
Read [the gameplay reference](docs/engineering/gameplay.md) for this section
and its applicable path rules before changing the domain.

## 6) Combat Tick Model
Read [the gameplay reference](docs/engineering/gameplay.md) for this section
and its applicable path rules before changing the domain.

## 7) Special Attacks
Read [the gameplay reference](docs/engineering/gameplay.md) for this section
and its applicable path rules before changing the domain.

## 8) Drops & Data Authoring
Read [the gameplay reference](docs/engineering/gameplay.md) for this section
and its applicable path rules before changing the domain.

## 9) UI/Styling
Read [the ui reference](docs/engineering/ui.md) for this section
and its applicable path rules before changing the domain.

## 10) PvP — the Wilderness (open world only)
Read [the multiplayer reference](docs/engineering/multiplayer.md) for this section
and its applicable path rules before changing the domain.

## 11) Build/Test Commands (Authoritative)
- `npm test` → full Vitest. `npm run test:coverage` → same suite with v8 coverage (writes `coverage/`, gitignored). `npm run build` → `prebuild` (`npm test`) + `vite build`. `npm run rebuild` → `tsc` + single-file concat (`build_single.cjs`). `npm run check:single` → duplicate-identifier/syntax check + eval-time TDZ smoke-run of the bundle. `npm run ci` → `typecheck` + `build` (**runs the full suite** via its `prebuild`) + `rebuild` + `gen:guide` + `check:single` + `gen:weapon-preview -- --check` + `gen:monster-preview -- --check`. `npm run build:app` → Capacitor/iOS.
- No lint script — style is review + `check:single`.

**Commit gate (required)** — run `npm run ci`; it is the full authoritative gate above. Don't commit with failing checks. Testing strategy, gates, and the feature→test map: **`TESTING.md`** + `.claude/rules/testing.md` (Claude hosts may auto-load on `tests/**`).

## 12) Single-file Build Safety
`index.html` is generated by `build_single.cjs` and gitignored (`/index.html`, `/game-*.js`) — never edit/commit it; change `src/**`. Full build-safety rules (eval-time TDZ traps, code-split/chunk rules, the 3D/GLB asset pipeline): path-scoped rule **`.claude/rules/single-file-build.md`** (Claude hosts may auto-load on `build_single.cjs`, `src/3d/**`, and related 3D asset scripts).

## 13) Delivery and shared skills
Before implementation or instruction changes, run `python3 tools/agent-skills.py`
and `python3 tools/agent-skills.py --check`. Read applicable installed
`.agents/skills/<name>/SKILL.md` files in full; delivery-loop also requires steps.md.
The exact dependencies are in `.agents/skills.lock.json`; generated Claude links
expose the same source. Never edit caches or enable duplicate marketplace copies.

Read [the workflow contract](docs/agent-workflows.md) for project-specific gates,
bootstrap fallback and updates. Use delivery-loop for implementation, plan-gate
for novel/multi-system work, scope-fence for edits, systematic-debugging for broken
behaviour, verification-before-completion before claims, and memory-hygiene for
persistent instructions. Use test-driven-development for regression construction.
No builder/QA agents; read-only Explore searches are the only sanctioned fan-out.

Keep engine logic pure and deterministic, test new logic, and preserve scope.
After three failed fixes stop and reassess architecture; never quarantine a test
or rerun until chance produces green. Fresh build evidence cannot prove visuals.

Project skills remain in `.claude/skills/`; consult [SKILLS.md](SKILLS.md) and read
applicable bodies explicitly: pr-changelog for every PR, ruthless-editor for prose,
add-content for data, action-animation for player actions, procgen-creature for
3D specs, save-item-grant for specific-character support grants.

Comments explain only non-obvious invariants; never narrate code or edits.
`migrations/*.sql` take no comments. Edit source of truth; no generated index.html
or game-*.js commits. Higher-priority instructions and user scope remain binding.

## 14) Production Security Model
Server is source of truth for everything that *can* be authoritative. The one deliberate exception: the save blob — no server-side engine recomputes the tick loop, so the client computes XP/coins/drops and the server trusts them. Know which side owns a thing before changing an endpoint. Full model (every server-authoritative surface, the admin portal, audit events, item-loss safety net, save-lock mechanics): path-scoped rule **`.claude/rules/server-authority.md`** (Claude hosts may auto-load on `functions/api/**`, `functions/_lib/**`, `worker/**`).
- **Server-authoritative, never move to client/save**: identity/auth, high-value grants (boss/raid/clue/minigame/dungeoneering uniques), purchases, credits, daily-task credit grants, Wilderness settlement/trading post, co-op boss fights, admin grants.
- **Client-trusted (the save blob)**: live skilling, idle/offline catch-up and skip-hour compute XP/coins/drops client-side. **Never add `/api/save` checks policing economy/item increases** — they break the core loop and buy no real protection; tighten integrity by moving a reward onto a server-authoritative endpoint instead.
- `/api/save` enforces exactly **three** anti-cheat-adjacent guards (stale-write rejection, total-level regression, bank-wipe). Saves are also **locked** entirely during an active co-op session (§20/§21) or a live open-world session.

## 15) MCP Server (`/api/mcp`)
Read [the integrations reference](docs/engineering/integrations.md) for this section
and its applicable path rules before changing the domain.

## 16) Help Chatbot (`/api/chat`)
Read [the integrations reference](docs/engineering/integrations.md) for this section
and its applicable path rules before changing the domain.

## 17) Context efficiency
Keep one coherent task in one session. Load task-relevant instructions once per
unchanged revision, preserve sufficient caller context, and append corrections.
Use targeted searches and bounded outputs; retain full failure logs outside the
prompt. Re-read changed or missing evidence and compact when correctness needs it.
Keep stable rules separate from changing task status; update the owning reference.

Give concise, useful handoffs: outcome, fresh checks, PR and verified preview links
when available, next step, and unverified items. Brevity never hides a failed gate.
Instruction size is not cache-hit telemetry. Host-managed Astra/ChatGPT caching
cannot be configured by repository Markdown. Optional evaluation instructions are
in delivery-loop/measurement.md; run paid experiments only when authorized.

[Headroom](HEADROOM.md) is an optional local Claude Code wrapper. It does not
reroute managed ChatGPT/Codex/cloud sessions. Never commit ANTHROPIC_BASE_URL into
shared settings. Neither compression nor this guidance guarantees cost savings.

## 18) Design Context
Read [the ui reference](docs/engineering/ui.md) for this section
and its applicable path rules before changing the domain.

## 19) PR titles & bodies are the public changelog
Merged PR title + body auto-post verbatim to the players' Discord `#changelog`. Voice, structure, and cutting pass → skill **`pr-changelog`** (fires on every PR write). Non-negotiable even without the skill: player-facing voice, and **never** any attribution, AI/Claude mention, session/GitHub link, secret, or internal note in the title or body. The common leak is a commit trailer (`Co-Authored-By`, `Claude-Session`) bleeding into the PR body — keep those in commits only, never the body. There is **no automated backstop**: the changelog workflow only strips `<!-- -->` comments, so whatever is in the PR title/body publishes verbatim. Getting this right is on the PR author.

## 20) Co-op Boss Fights (`/api/coop/**`)
Read [the multiplayer reference](docs/engineering/multiplayer.md) for this section
and its applicable path rules before changing the domain.

## 21) Raid Parties (`/api/coop/raid/**`)
Read [the multiplayer reference](docs/engineering/multiplayer.md) for this section
and its applicable path rules before changing the domain.

