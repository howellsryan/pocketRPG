# CLAUDE.md — PocketRPG Contributor Guide

> **Purpose**: Fast, reliable, *accurate* instructions for AI/human contributors. Claude Code loads this file every session. Keep it aligned with the live codebase and scripts — when behaviour or scripts change, update this file in the same change.

## 0) Orientation (read first)
- **Product**: menu-driven, tick-based, mobile-first fantasy **idle RPG**. Deterministic core logic; account-gated and server-backed — the client runs the game loop locally for responsiveness and syncs to a server that is the source of truth for accounts, high-value grants, and competitive/social systems (§14).
- **Where code lives**: client game in `src/`, Cloudflare server in `functions/`, static content in `src/data/`, logic tests in `tests/`.
- **The build is a single file**: the deployed app is a generated, **gitignored** `index.html` + a lazy `game-<hash>.js` chunk (see §12). Edit sources in `src/**`, never the generated output.
- **Before you commit**: pass the §11 commit gate. Don't commit with failing checks.
- **§16 (token discipline) is mandatory** and applies to every session, including web/cloud.

## 1) Project Snapshot
- **Genre**: idle/simulation fantasy RPG with OSRS-style combat/skilling mechanics (PocketRPG-owned fantasy naming).
- **Engine tick**: 600ms (`TICK_MS = 600`).
- **Goals**: mobile-first UI, low-latency local play (client runs the tick loop, then syncs), deterministic core logic. Requires an account and server connectivity (auth, characters, rewards, PvP, payments are all server-side).
- **Hosting**: Cloudflare Pages (`pages_build_output_dir = "."`); server logic runs as Pages Functions.

## 2) Tech Stack (Current)
- **UI**: Preact + JSX (no React). Reuse shared components in `src/components/`.
- **Styling**: **Tailwind v4 compiled** from `src/index.css` (`@import "tailwindcss"`) by `build_single.cjs` via the Tailwind CLI — **not a CDN**. Design tokens are CSS variables in `:root` (`src/index.css`). Fonts are self-hosted through `@fontsource` (latin subset, no CDN).
- **Client persistence**: IndexedDB (via `idb`) + `localStorage`.
- **Server**: Cloudflare **Pages Functions** in `functions/` over a **D1** (SQLite) database (binding `DB`, schema in `migrations/*.sql`). Auth is a session **JWT** (`JWT_SECRET`) issued via GitHub/Google OAuth login; PocketRPG is also its own **OAuth 2.1** authorization server for MCP (§15). Payments via **Stripe** Checkout (`functions/api/stripe/`).
- **Build tooling**: Vite + TypeScript transpile, then single-file concatenation (`build_single.cjs`).
- **Mobile**: Capacitor (iOS) — `npm run build:app`, `capacitor.config.ts`, `ios/`.
- **Tests**: Vitest, logic-only (`tests/**/*.test.ts`).

## 3) Repository Layout Rules
**Client (`src/`)** — `src/engine/` is pure game logic with **no UI imports**:
- `src/engine/`: deterministic game logic (combat, XP, idle sim, loot). No Preact/UI imports.
- `src/screens/`: top-level UI screens.
- `src/components/`: shared, reusable UI components.
- `src/state/`: Preact context/hooks and app state wiring (`gameState.jsx`).
- `src/hooks/`: reusable Preact hooks.
- `src/cloud/`: client-side cloud sync + `/api` client.
- `src/db/`: IndexedDB persistence/data access.
- `src/data/`: static JSON content definitions — **treat as immutable content data**.
- `src/utils/`: shared top-level helpers (`helpers.js`) — prefer these over redefining common names (§12).

**Server (`functions/`)** — Cloudflare Pages Functions:
- `functions/api/**`: HTTP endpoints (`/api/save`, `/api/actions/**`, `/api/pvp/**`, `/api/purchase`, `/api/mcp`, `oauth/**`, `stripe/**`, …).
- `functions/_lib/**`: shared server libs (`mcp/`, `oauth/`, `game/`, `pvpRanks.js`, `jwt.js`, …).
- `functions/.well-known/**`: OAuth discovery documents.

**Other**:
- `migrations/`: D1 SQL migrations, ordered `NNNN_name.sql`.
- `tests/**/*.test.ts`: logic regression tests (Vitest).
- `scripts/`: build/seed/maintenance scripts (`check-single-file-build.cjs`, `seed-pvp-bots.cjs`, `headroom-claude.sh`).
- `docs/`: design and implementation plans (incl. `mcp-roadmap.md`, `mcp-gap-plan.md`).

## 4) Core Gameplay Invariants
- Always use `Math.floor()` for gameplay rounding.
- Inventory capacity is a hard **28-slot** limit.
- HP regeneration: **+1 HP per 60s**.
- Auto-bank trigger: full inventory; delay scales from **5m (Agility 1) to 10s (Agility 99)**.
- Combat style bonuses:
  - Accurate/Aggressive/Defensive: **+3** relevant effective level.
  - Controlled: **+1** to attack/strength/defence effective levels.
- Dragonfire: **33% proc, max 50 hit**, fully blocked by `otherBonus.antiDragon: true`.
- **Prayer (live combat, PvE + PvP)**: drains a prayer-point pool that maxes at the player's Prayer level. Each active prayer drains over time; higher-tier prayers drain faster (`drainPerMinute` in `src/data/prayers.json`). When the pool empties, active prayers switch off. Pool starts full per combat session and persists across auto-fight kills. Prayer potion restores 20, super restore 22 (live + idle). PvP keeps protection prayers disabled (v1), so only offensive prayers drain there. **Single source of truth: `src/engine/prayerDrain.js`** (idle keeps its own pool in `src/engine/idleSupplies.js`).
- **Combo food**: combo consumables — combo food (flagged `combo: true`, e.g. Karam) plus every potion/brew — use a **separate combo cooldown**, so ONE combo item may be used on the same tick as one normal food (and never delays the next attack). See `isComboConsumable` in `src/engine/consumables.js`; honoured by both `combat.js` (PvE) and `pvpEngine.js` (PvP).
- **Boss Slayer XP**: `BOSS_SLAYER_TASK_XP_MULTIPLIER` (×4) in `src/engine/slayerRewards.js`; avoid inflated explicit `slayerXP` on bosses so XP/hr stays at most ~2× the best regular monster.

## 5) XP & Leveling
- Level range: **1–99**. XP cap: **200,000,000**.
- XP formula: `totalXP(L) = floor(sum(x=1..L-1, floor(x + 300 * 2^(x/7)) / 4))`.
- Starting HP level baseline: level **10** (1,154 XP).
- XP gains:
  - Combat: **4 XP per damage** to primary skill, **1.33 XP per damage** to HP.
  - Magic: base spell XP + **2 XP per damage**.

## 6) Combat Tick Model
- Global tick: **600ms**.
- Melee max hit: `floor(0.5 + effectiveStr * (bonus + 64) / 640)`.
- Accuracy:
  - `maxRoll = effectiveLevel * (bonus + 64)`
  - if `attackRoll > defRoll`: `1 - (defRoll + 2) / (2 * (attackRoll + 1))`
  - else: `attackRoll / (2 * (defRoll + 1))`
- Auto-fight restart delay after kill: **1.2s**.

## 7) Special Attacks
- PvE special energy (`combatState.specialAttackEnergy`) is **0–100**: starts each fight at 100, drains on use, refills on kill.
- Manual trigger only via combat UI (`⚡ Special Attack`). No automatic/offline special-attack firing.

### Adding a weapon with a special attack
1. Confirm the weapon has an existing PocketRPG design and maintain PocketRPG-owned fantasy naming.
2. Confirm adaptation design with the user for PocketRPG-specific behavior.
3. Add `specialAttack` object to the item in `src/data/items.json`.
4. Implement behavior in `applySpecialAttack()` in `src/engine/combat.js`.
5. Add a label entry in `specLabels` in the combat screen handling.

Schema:
```json
"specialAttack": {
  "type": "string",
  "energyCost": 25,
  "description": "Player-facing description",
  "stunTicks": 33,
  "minHeal": 10,
  "lightningMax": 16
}
```

## 8) Drops & Data Authoring
- Before adding a monster drop, ensure every referenced item exists in `src/data/items.json`.
- **Item Naming**: all item `name` fields use **Title Case** (each word capitalized), e.g. "Bronze Dagger", "Oak Logs", "Iron Ore".
- Stackables (coins/runes/arrows): quantity as `[min, max]`.
- Non-stackable equipment: `quantity: 1`.
- **Collection log upkeep**: whenever adding a new boss unique, raid unique, minigame reward, or clue reward, add the matching slot to `src/data/collectionLog.json` in the same change and include/update a regression test.

## 9) UI/Styling Rules
- Minimum tap target: **44×44px**.
- Prefer Tailwind utility classes + CSS variables from `src/index.css` (`:root`).
- Avoid inline `style={{}}` unless the value is truly dynamic per render (e.g. computed widths/colors).
- Do **not** use Tailwind `/N` opacity modifiers; use solid CSS variable colors.
- Reuse shared components in `src/components/` before inventing new wrappers.
- A new shared component must be registered in `build_single.cjs` `sourceFiles` (follow existing ordering conventions); in-game screens also go in `GAME_CHUNK_FILES` (§12).

## 10) PvP Rules (Current Lockdown)
PvP is server-authoritative under `/api/pvp/*`. The full rules — matchmaking, save-lockdown, special-energy/equipment-swap timing, magic parity, and the bot system — live in the path-scoped rule **`.claude/rules/pvp.md`**, which auto-loads when you open `functions/api/pvp/**`, `functions/_lib/pvp*`, `src/engine/pvp*`, `src/data/pvpBots.json`, or `functions/api/leaderboard.js`. The shared combat tick model is §6; prayer/combo invariants are §4.

## 11) Build/Test Commands (Authoritative)
npm scripts are the source of truth:
- `npm test` → full Vitest run.
- `npm run build` → runs `prebuild` (`test:logic`) then `vite build`.
- `npm run rebuild` → `tsc` transpile + single-file concat via `build_single.cjs`.
- `npm run check:single` → duplicate-identifier/syntax safety for single-file output.
- `npm run ci` → `build` + `rebuild` + `check:single` (note: this does **not** run the full `npm test`).
- `npm run build:app` → Capacitor/iOS build.
- There is **no lint script** — style is enforced by review + `check:single`, not a linter.

### Commit gate (required)
Before commit/push, run either:
- `npm test && npm run build && npm run rebuild && npm run check:single`, **or**
- `npm run ci` **and** `npm test`.

Do not commit with failing checks.

## 12) Single-file Build Safety
- The deployed `index.html` is **generated** by `build_single.cjs` (concatenating transpiled modules) and is **gitignored** (`/index.html`, `/game-*.js` in `.gitignore`) — never edit or commit it; change sources in `src/**`.
- Top-level declarations must be **globally unique** across both output files. Treat duplicate-identifier syntax errors as release-blocking. Prefer shared helpers from `src/utils/helpers.js` over redefining common top-level names.

### Code-split: core script + lazy game chunk
- `build_single.cjs` emits **two CLASSIC scripts** (not `type="module"`): the inline core in `index.html`, and a content-hashed `game-<hash>.js` chunk with the heavy in-game screens (`GAME_CHUNK_FILES`). The chunk loads lazily once the player enters the game (`cloudPhase === 'ready'`) via `globalThis.__loadGameChunk`, keeping ~130 KiB off the landing/login page.
- Classic scripts share one global lexical environment, so cross-references resolve **by source name**. Both bundles minify with `minifyIdentifiers: false` to keep names stable — **do not re-enable identifier minification**. `npm run check:single` syntax-checks each artifact plus the combined concatenation to catch cross-script redeclarations.
- Adding a new **in-game** screen: add it to `sourceFiles` **and** `GAME_CHUNK_FILES`. Landing/auth-reachable screens must stay **out** of `GAME_CHUNK_FILES`, and nothing in core may reference a chunk binding at module-evaluation time (only inside `renderScreen`).
- `gameIconsData` (~126 KiB icon glyph map) is injected into the **chunk**, not core. Core icon code (`GameIcon`, `itemIcons`, `skillArt`) guards every access with `typeof gameIconsData !== 'undefined'` and falls back to an emoji until the chunk loads. **Keep those guards** if you touch icon code.

## 13) Contribution Best Practices for Agents
- Keep changes minimal and scoped; avoid unrelated refactors.
- Update tests with new gameplay logic (deterministic, logic-only).
- Prefer source-of-truth edits in `src/**` (and `functions/**` for server); generated output follows from build scripts.
- **Never** commit the generated `index.html` / `game-*.js` — they are gitignored build artifacts produced by `npm run rebuild`.
- If instructions here conflict with direct user/developer/system instructions, higher-priority instructions win.
- When this guide becomes stale, update it in the same change as the behavior/script change.

## 14) Production Security Model (Server Authority)
The server is the source of truth for everything that *can* be made authoritative. The one deliberate exception is the save blob: there is no server-side game engine to recompute the tick loop, so the client computes XP/coins/drops and the server trusts them. Know which side owns each thing before you change an endpoint.

**Server-authoritative (the integrity boundary — never move these to the client/save):**
- **Identity & ownership** — auth (session JWT via `requireAuth`), characters, and OAuth all live server-side; every `/api/*` route verifies the token.
- **High-value reward grants** — boss/raid/clue/minigame/dungeoneering uniques are granted by the completion endpoints (`/api/actions/**`), which roll loot RNG server-side, record kill-counts and collection-log entries, and claim a nonce for replay protection. The save merely carries the already-granted item.
- **Purchases** — `/api/purchase` debits coins and grants the item server-side.
- **Credits** — debited atomically by `/api/skip-hour` and `/api/slayer/skip`; **never** bumped from `/api/save`.
- **PvP settlement / trading post** — their own server-authoritative paths (§10).
- New API mutations that can materially change economy/progression must emit **audit events** (`functions/_lib/game/audit.js`).

**Client-trusted (the save blob — a deliberate, bounded exception, not an oversight):**
- Live skilling, idle/offline catch-up, and skip-hour compute XP, coins, and drops on the **client** and persist them through `/api/save`. XP/coins and client-created items (idle/offline loot, crafted/smithed/cooked products, skill capes) ride in the trusted blob because the same client paths legitimately create them and the server has no engine to re-derive them.
- Because of this, the leaderboard is best-effort, not cheat-proof. Do **not** add `/api/save` checks that police economy/item *increases* — they break the core loop and buy no real protection while XP/coins are client-computed. Tighten integrity by moving a reward onto a server-authoritative endpoint, not by validating the save.
- `/api/save` enforces exactly **two** write guards (integrity, not anti-cheat): stale-write rejection (`save_revision`) and the total-level regression guard (account-wipe protection — a save whose total level drops below the stored one is refused; see `functions/_lib/game/saveValidation.js`). Saves are also locked entirely while a PvP match is active.

## 15) MCP Server (`/api/mcp`)
A stateless MCP server (JSON-RPC 2.0) lives at `functions/api/mcp.js`, with its own OAuth 2.1 authorization server. The full architecture and the **how-to-add-a-tool** extension rule (bridge tools vs. save-intents, the required `schema.js`/`tools.js`/test trio, and `applyTaskResult.js` as the single source of truth) live in the path-scoped rule **`.claude/rules/mcp.md`**, which auto-loads when you open `functions/api/mcp.js`, `functions/_lib/mcp/**`, the OAuth paths (`functions/_lib/oauth/**`, `functions/api/oauth/**`, `functions/.well-known/**`), `src/screens/OAuthConsentScreen.jsx`, or `tests/mcp*.test.ts`.

## 16) Token efficiency — MANDATORY (Headroom-style discipline)
> These rules replicate, in-session, the token savings Headroom's proxy gets mechanically. They are **not optional** and apply to **every** session (web/cloud included, where the local wrapper cannot reach). Follow them by default; deviate only when the user explicitly asks for more detail.

**A) Output shaping — HARD DEFAULT (replicates Headroom's verbosity steering. This is the rule violated most often; obey it literally):**
- **Lead with the answer or result in the first sentence.** No preamble ("Sure, I'll…", "Great question", "You're right"), no postamble ("Let me know if…", "Hope this helps"), no restating the question, the plan, or what you just did.
- **Budget: ≤6 lines for a routine reply; a post-edit status update is 1–3 lines.** Exceed this only when the user asks for depth, or correctness genuinely needs a table / numbered steps / code block — then still delete every sentence that adds no information.
- **Never echo context the user can already see**: file contents you just edited, tool output, diffs, full commands, or their own request. Point to it (`save.js:146`); don't reproduce it.
- **No step narration** ("Now I'll read X…", "Let me check Y") — just call the tool. **No closing recap** of work the diff or tool output already shows, and **no unprompted "what I changed and why" justification**.
- **One idea per line; cut filler** ("it's worth noting", "as you can see", "in order to", "I went ahead and"). If a sentence survives deletion without information loss, delete it.
- If you catch yourself writing a recap, a justification, or a summary the user didn't ask for, stop and delete it before sending.

**B) Effort routing (replicates Headroom's effort routing):**
- Spend minimal reasoning on routine/mechanical work (file reads, obvious edits, passing tests, lookups). Reserve deep reasoning for genuinely novel or ambiguous problems.

**C) Intake reduction (replicates Headroom's context/tool-output compression by not pulling bulk into context):**
- Read narrowly: targeted `Grep`/`Glob`, `Read` with `offset`/`limit`, request only the PDF pages/lines you need. Avoid whole-file reads when a slice suffices.
- Prefer `files_with_matches` first; escalate to `content` only when necessary.
- Don't re-read a file already in context (Edit/Write already confirm success) and don't re-derive established facts.
- Batch independent tool calls in one turn; avoid exploratory/redundant calls.
- Fetch-on-demand, not just-in-case: pull data when a step needs it, not preemptively.

**Enforcement note:** `CLAUDE.md` is strong standing guidance, not a hard mechanical gate. For mechanically-enforced compression on *local* sessions, additionally launch via the Headroom wrapper below.

### Headroom wrapper (optional, local sessions only)
- To run Claude Code through actual [Headroom](https://github.com/headroomlabs-ai/headroom) compression + response shaping, launch via the wrapper instead of bare `claude`: `npm run claude:headroom` (== `scripts/headroom-claude.sh`). One-time prereq: `pip install "headroom-ai[all]"`.
- The wrapper sets `HEADROOM_OUTPUT_SHAPER=1` to shorten responses; see `HEADROOM.md` for the full env table and proxy alternative.
- Scope: this wraps Claude Code **at launch time, locally**. It does not affect already-running sessions and cannot reroute Claude Code Web / cloud sessions (their model transport is Anthropic-managed) — which is why section 16's rules above carry the load for web sessions. Do not commit `ANTHROPIC_BASE_URL` into shared settings — it would break sessions with no local proxy listening.
