# CLAUDE.md — PocketRPG Contributor Guide

> **Purpose**: Fast, reliable, *accurate* instructions for AI/human contributors. Claude Code loads this file every session. Keep it aligned with the live codebase and scripts — when behaviour or scripts change, update this file in the same change.

## 0) Orientation (read first)
- **Product**: menu-driven, tick-based, mobile-first fantasy **idle RPG**. Deterministic core logic, offline-first.
- **Where code lives**: client game in `src/`, Cloudflare server in `functions/`, static content in `src/data/`, logic tests in `tests/`.
- **The build is a single file**: the deployed app is a generated, **gitignored** `index.html` + a lazy `game-<hash>.js` chunk (see §12). Edit sources in `src/**`, never the generated output.
- **Before you commit**: pass the §11 commit gate. Don't commit with failing checks.
- **§16 (token discipline) is mandatory** and applies to every session, including web/cloud.

## 1) Project Snapshot
- **Genre**: idle/simulation fantasy RPG with OSRS-style combat/skilling mechanics (PocketRPG-owned fantasy naming).
- **Engine tick**: 600ms (`TICK_MS = 600`).
- **Goals**: mobile-first UI, offline-first gameplay, deterministic core logic.
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
- Server-authoritative under `/api/pvp/*`.
- Matchmaking constraints: combat level ±10; Ironman and One-Life blocked.
- Save/idle/purchase/skip-hour writes are **locked** while `characters.active_match_id` is set.
- Tick cadence: 600ms; deterministic ordering by tick + character ids.
- PvP special energy: starts at 100, regenerates **+10 every 30s**, capped at 100.
- **Equipment swap never adds an attack delay** (OSRS parity): equipping/unequipping leaves `attackTimer` untouched — a ready attack swings with the newly equipped weapon on the same tick; mid-cooldown swaps keep the remaining cooldown, and the new weapon's speed applies from the next swing.
- Simultaneous deaths tie-breaker: lower `characterId`.
- Protection prayers disabled in PvP v1 (only offensive prayers apply, and they drain the prayer pool — see §4).
- Forfeit is treated as death for loot transfer.
- **Magic combat (PvE parity)**: all three styles fight in PvP. `combatType` is derived from the equipped weapon; magic uses the shared `resolveMagicSwing` (`src/engine/combatPrimitives.js`). Standard spells consume runes from the combatant's **inventory** per cast (an equipped elemental staff supplies its element rune free, as in PvE; the bank is never consulted in combat) and a cast is blocked with a `no_runes` event when runes run out. Powered staves (`item.poweredStaff`, e.g. Trident) need no spell/runes and scale max hit off magic level. The active spell is seeded from `save.settings.activeCombatSpell` at match start and changed mid-fight via the `change_combat_spell` intent (validated in `intent.js`; resolved against `src/data/spells.json` by the engine).

### PvP Bot System
- Bots live in the `characters` table with `is_bot=1` and a `bot_template_id` referencing `src/data/pvpBots.json`. Seeded once via `scripts/seed-pvp-bots.cjs` (`npm run seed:bots`).
- **Four integration seams**:
  1. **Lobby** — `GET /api/pvp/waiting` UNIONs virtual bot entries for the player's CB band.
  2. **Auto-accept** — `POST /api/pvp/invitations` detects `target.is_bot` and calls `createMatch()` immediately.
  3. **AI injection** — `tick.js` calls `computeBotIntents(state, botId, itemsData)` before `processPvpTick`, merging intents in-memory (no DB writes for bot actions).
  4. **Post-match reset** — `resetBotSave(env, botCharacterId)` rebuilds the bot's save from its template after every match end or stall-abort.
- **Loot on bot match end** (server-authoritative, `finalizeTerminalMatch`): human wins → `rollBotLootBox()` grants coins or a ~2% Zesta unique to the human's bank (collection log written for Zesta); bot wins → `splitInventoryByTradeable()` strips the human's tradeable gear (item sink). Normal `applyLootTransfer` is bypassed for bot matches.
- **Reward items** (untradeables, collection log category `pvp` / section `pvp_bots`): `zesta_longsword`, `zesta_vest`, `zesta_skirt`.
- `aiProfile` in the template selects behaviour in `src/engine/pvpBotAI.js`.
- Bots are excluded from the PvP kill-count rank ladder (the ranking query filters `is_bot = 0`; see `functions/_lib/pvpRanks.js` and `functions/api/leaderboard.js`).

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
- PocketRPG is offline-first: live skilling, idle/offline catch-up, and skip-hour compute XP, coins, and drops on the **client** and persist them through `/api/save`. There is no server-side game engine to recompute against, so XP/coins (and any client-created items: idle/offline loot, crafted/smithed/cooked products, skill capes) are **client-authoritative by design**. The leaderboard is best-effort, not cheat-proof — do **not** add `/api/save` checks that police economy/item *increases*; they break the core loop and provide no real protection while XP/coins remain client-side.
- Integrity is enforced where it actually *can* be server-authoritative, not on the trusted save:
  - **High-value reward grants** — boss/raid/clue/minigame/dungeoneering uniques are granted by the server-side completion endpoints (`/api/actions/**`), which roll loot RNG server-side, record kill-counts and collection-log entries, and claim a nonce for replay protection. The save merely carries the already-granted item.
  - **Purchases** — `/api/purchase` debits coins and grants the item server-side.
  - **Credits** — debited atomically by `/api/skip-hour` and `/api/slayer/skip`; never bumped from `/api/save`.
  - **PvP settlement / trading post** — their own server-authoritative paths.
- `/api/save` enforces exactly two write guards (integrity, not anti-cheat): stale-write rejection (`save_revision`) and the total-level regression guard (account-wipe protection — a save whose total level drops below the stored one is refused).
- New API mutations that can materially change economy/progression must emit **audit events**.

## 15) MCP Server (`/api/mcp`)
- A stateless MCP (Model Context Protocol) server lives in the Pages app at `functions/api/mcp.js` (JSON-RPC 2.0 over POST). It lets AI assistants view characters and run server-authoritative actions, and serves context via `instructions` + resources (`functions/_lib/mcp/reference.js`). Roadmap: `docs/mcp-roadmap.md`; gap-closure: `docs/mcp-gap-plan.md`.
- Tools never duplicate game logic: each `tools/call` forwards the caller's bearer token to the matching `/api/*` handler via `functions/_lib/mcp/bridge.js`, so all auth/locks/audit run in the existing endpoints. Adding a tool = add it to `functions/_lib/mcp/schema.js` (metadata) and `functions/_lib/mcp/tools.js` (dispatch).
- Auth is **OAuth 2.1** (PKCE + Dynamic Client Registration), tailored for ChatGPT custom connectors. PocketRPG is its own authorization server (`functions/api/oauth/**`, `functions/.well-known/**`, `functions/_lib/oauth/**`, migration `0022`); the issued access token is the normal session JWT, verified by `requireAuth` like every other route. The in-app consent screen is `src/screens/OAuthConsentScreen.jsx` (reached via `/?oauth=…`, must stay **out** of `GAME_CHUNK_FILES`). No new secrets — reuses `JWT_SECRET`.

### MCP extension rule (how to add or change a tool)
1. **Default to a bridge tool** — import the real `/api/*` handler and call it via `callHandler` in `tools.js`. API changes (auth, locks, audit, validation) propagate for free; nothing in `intents.js` needs to change.
2. **Use a save-intent only when no endpoint exists** — write a pure function in `functions/_lib/mcp/intents.js` that mutates the decoded save object in place and throws `GameApiError` on bad input. Intents **must** reuse shared `src/engine` helpers (especially `applyTaskResult` from `src/engine/applyTaskResult.js` for any idle-sim result) — never re-code reward application.
3. **Adding a tool always requires three files**: `schema.js` (metadata + JSON Schema input), `tools.js` (dispatch handler), and a test in `tests/mcpIntents.test.ts` or `tests/mcpServer.test.ts`. The parity test in `tests/mcpServer.test.ts` ("every advertised tool has a dispatch handler") enforces schema ↔ dispatch lockstep.
4. **`src/engine/applyTaskResult.js` is the single source of truth** for applying idle simulation results (XP, bank, inventory, HP, ammo/charges, dungeoneeringTokens) to a save. Both the MCP (`intents.js`) and the browser (`gameState.jsx`) import it. Never copy-paste this logic — extend the shared module.
- Keep scope to three kinds of action: reads, server-authoritative bridge tools (the legitimate grant/spend paths), and *constrained* save intents — pure, validated mutations that reuse `src/engine` helpers. Never expose a raw/arbitrary save write: anything that grants a high-value unique or spends credits/points must go through its existing endpoint, not an intent. See `docs/mcp-roadmap.md` for the shipped surface and the deliberately-excluded set.

## 16) Token efficiency — MANDATORY (Headroom-style discipline)
> These rules replicate, in-session, the token savings Headroom's proxy gets mechanically. They are **not optional** and apply to **every** session (web/cloud included, where the local wrapper cannot reach). Follow them by default; deviate only when the user explicitly asks for more detail.

**A) Output shaping (replicates Headroom's verbosity steering — "be terse, don't restate context"):**
- Answer directly. No preamble ("Sure, I'll…"), no postamble ("Let me know if…"), no restating the question or the plan.
- Don't re-describe context already visible to the user (file contents you just edited, tool output, their own request). Reference it; don't echo it.
- Default to the shortest correct answer — a sentence or a few bullets. Prose over headings; skip section scaffolding unless the answer is genuinely long.
- Report results plainly; don't narrate routine steps ("Now I'll read X…") — just do them.

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
