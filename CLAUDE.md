# CLAUDE.md — PocketRPG Contributor Guide

> Accurate, terse instructions for AI/human contributors, loaded every session. When behaviour or scripts change, update this file in the same change. Keep it short — it's input-token cost on every session.

## 0) Orientation
- **Product**: menu-driven, tick-based, mobile-first fantasy **idle RPG**. Deterministic core; client runs the game loop locally and syncs to a server that is the source of truth for accounts, high-value grants, and competitive/social systems (§14).
- **Code**: client in `src/`, Cloudflare server in `functions/`, content in `src/data/`, tests in `tests/`.
- **Build**: deployed app is a generated, gitignored `index.html` + lazy `game-<hash>.js` (§12). Edit `src/**`, never the generated output.
- Pass the §11 commit gate before committing. §17 (token discipline) applies to every session.

## 1) Snapshot
- Idle/sim fantasy RPG with OSRS-style combat/skilling (PocketRPG-owned fantasy naming).
- Tick: 600ms (`TICK_MS = 600`). Goals: mobile-first UI, low-latency local play, deterministic core. Requires an account + server connectivity (auth, characters, rewards, PvP, payments all server-side).
- Hosting: Cloudflare Pages (`pages_build_output_dir = "."`); server logic runs as Pages Functions.

## 2) Tech Stack
- **UI**: Preact + JSX (no React). Reuse `src/components/`.
- **Styling**: Tailwind v4 compiled from `src/index.css` (`@import "tailwindcss"`) by `build_single.cjs` via Tailwind CLI — not a CDN. Tokens are CSS variables in `:root`. Fonts self-hosted via `@fontsource` (latin subset).
- **Client persistence**: IndexedDB (`idb`) + `localStorage`.
- **Server**: Pages Functions in `functions/` over **D1** (SQLite, binding `DB`, schema in `migrations/*.sql`). Auth is a session **JWT** (`JWT_SECRET`) via GitHub/Google OAuth; PocketRPG is also its own **OAuth 2.1** server for MCP (§15). Payments via **Stripe** Checkout (`functions/api/stripe/`).
- **Build**: Vite + TS transpile, then single-file concat (`build_single.cjs`). **Mobile**: Capacitor/iOS (`npm run build:app`). **Tests**: Vitest, logic-only (`tests/**/*.test.ts`).

## 3) Repository Layout
**Client `src/`** — `src/engine/` is pure logic, **no UI imports**:
- `engine/` deterministic logic (combat, XP, idle sim, loot) · `screens/` top-level UI · `components/` shared UI · `state/` Preact context/wiring (`gameState.jsx`) · `hooks/` Preact hooks · `cloud/` cloud sync + `/api` client · `db/` IndexedDB · `data/` static JSON content (**immutable**) · `utils/` shared helpers (`helpers.js`, prefer over redefining — §12).

**Server `functions/`** — Pages Functions:
- `api/**` HTTP endpoints (`/api/save`, `/api/actions/**`, `/api/pvp/**`, `/api/purchase`, `/api/mcp`, `oauth/**`, `stripe/**`) · `_lib/**` shared libs (`mcp/`, `oauth/`, `game/`, `pvpRanks.js`, `jwt.js`) · `.well-known/**` OAuth discovery.

**Other**: `migrations/` D1 SQL (`NNNN_name.sql`) · `tests/**/*.test.ts` Vitest · `scripts/` build/seed/maintenance · `docs/` design plans.

## 4) Gameplay Invariants
- Round with `Math.floor()`. Inventory cap = **28** slots. HP regen **+1/60s**.
- Auto-bank on full inventory; delay **5m (Agility 1) → 10s (Agility 99)**.
- Combat style: Accurate/Aggressive/Defensive **+3** relevant effective level; Controlled **+1** to attack/strength/defence.
- Dragonfire: **33% proc, max 50**, fully blocked by `otherBonus.antiDragon: true`.
- **Prayer (live PvE+PvP)**: drains a pool maxing at Prayer level; each prayer drains over time, higher tiers faster (`drainPerMinute` in `src/data/prayers.json`). Empty pool → prayers off. Pool starts full per session, persists across auto-fight kills. Prayer potion restores 20, super restore 22 (live+idle). PvP keeps protection prayers off (v1) so only offensive prayers drain. **Source of truth: `src/engine/prayerDrain.js`** (idle keeps its own pool in `src/engine/idleSupplies.js`).
- **Combo food**: combo consumables (flagged `combo: true`, e.g. Karam, plus every potion/brew) use a **separate combo cooldown** — one combo item may be used the same tick as one normal food, never delaying the next attack. See `isComboConsumable` in `src/engine/consumables.js`; honoured by `combat.js` (PvE) + `pvpEngine.js` (PvP).
- **Boss Slayer XP**: `BOSS_SLAYER_TASK_XP_MULTIPLIER` (×4) in `src/engine/slayerRewards.js`; avoid inflated explicit `slayerXP` on bosses (keep XP/hr ≤ ~2× best regular monster).
- **Daily Tasks**: 5 tasks/day (one per tier: Novice → Grandmaster), reset **00:00 UTC**, **+1 credit** each. Server-authoritative grant via `/api/daily-tasks/complete` (idempotent `credited` flag + audit), **never** via `/api/save`. Issuance is lazy on `GET /api/daily-tasks`; durable table `character_daily_tasks` (migration 0025, outside the save blob). Cloud accounts only (mirrors credits pill). Event bus: `recordGameEvent(evt)` in `gameState.jsx`; matcher: `src/engine/dailyTasks.js`.

## 5) XP & Leveling
- Levels **1–99**. XP cap **200,000,000**.
- `totalXP(L) = floor(sum(x=1..L-1, floor(x + 300 * 2^(x/7)) / 4))`.
- Starting HP level **10** (1,154 XP).
- Gains: Combat **4 XP/damage** to primary skill, **1.33 XP/damage** to HP. Magic: base spell XP + **2 XP/damage**.

## 6) Combat Tick Model
- Tick **600ms**.
- Melee max hit: `floor(0.5 + effectiveStr * (bonus + 64) / 640)`.
- Accuracy: `maxRoll = effectiveLevel * (bonus + 64)`; if `attackRoll > defRoll`: `1 - (defRoll + 2)/(2*(attackRoll + 1))`, else `attackRoll/(2*(defRoll + 1))`.
- Auto-fight restart delay after kill: **1.2s**.

## 7) Special Attacks
- PvE special energy (`combatState.specialAttackEnergy`) **0–100**: starts each fight at 100, drains on use, refills on kill.
- Manual trigger only (`⚡ Special Attack`). No automatic/offline firing.

### Adding a weapon special attack
1. Confirm existing PocketRPG design + fantasy naming.
2. Confirm adaptation behavior with the user.
3. Add `specialAttack` to the item in `src/data/items.json`.
4. Implement in `applySpecialAttack()` in `src/engine/combat.js`.
5. Add a `specLabels` entry in the combat screen.

```json
"specialAttack": { "type": "string", "energyCost": 25, "description": "...", "stunTicks": 33, "minHeal": 10, "lightningMax": 16 }
```

## 8) Drops & Data Authoring
- Before adding a drop, ensure every referenced item exists in `src/data/items.json`.
- Item `name` fields use **Title Case** (e.g. "Bronze Dagger", "Oak Logs").
- Stackables (coins/runes/arrows): quantity `[min, max]`. Non-stackable equipment: `quantity: 1`.
- **Collection log**: when adding a boss/raid/minigame/clue unique, add the matching slot to `src/data/collectionLog.json` in the same change + a regression test.

## 9) UI/Styling
- Min tap target **44×44px**. Prefer Tailwind utilities + `:root` CSS variables.
- Avoid inline `style={{}}` unless truly dynamic per render. No Tailwind `/N` opacity modifiers — use solid CSS variable colors.
- Reuse `src/components/` before new wrappers. New shared component → register in `build_single.cjs` `sourceFiles`; in-game screens also go in `GAME_CHUNK_FILES` (§12).

## 10) PvP
Server-authoritative under `/api/pvp/*`. Full rules (matchmaking, save-lockdown, special-energy/equip-swap timing, magic parity, bots) live in path-scoped rule **`.claude/rules/pvp.md`** (auto-loads on `functions/api/pvp/**`, `functions/_lib/pvp*`, `src/engine/pvp*`, `src/data/pvpBots.json`, `functions/api/leaderboard.js`). Tick model §6; prayer/combo §4.

## 11) Build/Test Commands (Authoritative)
- `npm test` → full Vitest. `npm run build` → `prebuild` (`test:logic`) + `vite build`. `npm run rebuild` → `tsc` + single-file concat (`build_single.cjs`). `npm run check:single` → duplicate-identifier/syntax check. `npm run ci` → `build` + `rebuild` + `check:single` (does **not** run full `npm test`). `npm run build:app` → Capacitor/iOS.
- No lint script — style is review + `check:single`.

**Commit gate (required)** — run either `npm test && npm run build && npm run rebuild && npm run check:single`, or `npm run ci` **and** `npm test`. Don't commit with failing checks.

## 12) Single-file Build Safety
- `index.html` is generated by `build_single.cjs` and gitignored (`/index.html`, `/game-*.js`) — never edit/commit it; change `src/**`.
- Top-level declarations must be **globally unique** across both output files; duplicate-identifier errors are release-blocking. Prefer `src/utils/helpers.js`.
- **Code-split**: two CLASSIC scripts (not modules) — inline core in `index.html` + content-hashed `game-<hash>.js` (heavy in-game screens, `GAME_CHUNK_FILES`), loaded lazily on `cloudPhase === 'ready'` via `globalThis.__loadGameChunk`. Classic scripts share one global lexical env; cross-refs resolve by source name. Both minify with `minifyIdentifiers: false` — **do not re-enable**.
- New in-game screen → add to `sourceFiles` **and** `GAME_CHUNK_FILES`. Landing/auth-reachable screens stay **out** of `GAME_CHUNK_FILES`; core must not reference a chunk binding at module-eval time (only inside `renderScreen`).
- `gameIconsData` (~126 KiB) is in the chunk. Core icon code (`GameIcon`, `itemIcons`, `skillArt`) guards every access with `typeof gameIconsData !== 'undefined'` + emoji fallback — **keep those guards**.

## 13) Agent Best Practices
- Keep changes minimal and scoped; no unrelated refactors. Update logic tests with new gameplay logic.
- **Comments: write very few.** Only for a non-obvious invariant/constraint the code can't express. Never narrate what code does, restate the change, or explain reasoning in comments — they cost tokens on every future read and go stale.
- Edit source of truth in `src/**` (+ `functions/**`); generated output follows from build scripts. Never commit `index.html` / `game-*.js`.
- Direct user/developer/system instructions outrank this file. Update this guide in the same change when it goes stale.

## 14) Production Security Model
Server is source of truth for everything that *can* be authoritative. The one deliberate exception: the save blob — no server-side engine recomputes the tick loop, so the client computes XP/coins/drops and the server trusts them. Know which side owns a thing before changing an endpoint.

**Server-authoritative (integrity boundary — never move to client/save):**
- **Identity & ownership** — auth (session JWT via `requireAuth`), characters, OAuth; every `/api/*` route verifies the token.
- **High-value grants** — boss/raid/clue/minigame/dungeoneering uniques granted by `/api/actions/**` (server-side loot RNG, kill-counts, collection-log, nonce replay protection). Save only carries the already-granted item.
- **Purchases** — `/api/purchase` debits coins + grants server-side. **Credits** — debited atomically by `/api/skip-hour`, `/api/slayer/skip`, and `/api/daily-tasks/complete`; **never** from `/api/save`.
- **Daily task credit grants** — `/api/daily-tasks/complete` atomically flips `credited=0→1` (idempotency key) then increments `credits`; replay returns `creditsGranted: 0`. PvP-lockdown enforced.
- **PvP settlement / trading post** — own server-authoritative paths (§10).
- New economy/progression mutations must emit **audit events** (`functions/_lib/game/audit.js`).

**Client-trusted (the save blob — deliberate, bounded):**
- Live skilling, idle/offline catch-up, skip-hour compute XP/coins/drops client-side and persist via `/api/save`. XP/coins + client-created items (idle/offline loot, crafted/smithed/cooked products, skill capes) ride the trusted blob since those paths legitimately create them and the server has no engine to re-derive them.
- Leaderboard is best-effort, not cheat-proof. Do **not** add `/api/save` checks policing economy/item *increases* — they break the core loop and buy no real protection. Tighten integrity by moving a reward onto a server-authoritative endpoint, not by validating the save.
- `/api/save` enforces exactly **two** guards (integrity, not anti-cheat): stale-write rejection (`save_revision`) and total-level regression guard (refuses a save whose total level drops below stored; `functions/_lib/game/saveValidation.js`). Saves are locked entirely during an active PvP match.

## 15) MCP Server (`/api/mcp`)
Stateless MCP server (JSON-RPC 2.0) at `functions/api/mcp.js` with its own OAuth 2.1 server. Architecture + how-to-add-a-tool (bridge tools vs save-intents, the `schema.js`/`tools.js`/test trio, `applyTaskResult.js` as single source of truth) live in path-scoped rule **`.claude/rules/mcp.md`** (auto-loads on `functions/api/mcp.js`, `functions/_lib/mcp/**`, OAuth paths, `src/screens/OAuthConsentScreen.jsx`, `tests/mcp*.test.ts`).

## 16) Help Chatbot (`/api/chat`)
- In-game helper (floating 💬, `src/components/ChatWidget.jsx`) that both answers PocketRPG questions **and performs actions** on the player's account. Backend `functions/api/chat.js`: tries `CHAT_OPENAI_MODEL` first (OpenAI chat completions + `OPENAI_API_KEY` secret, skipped entirely if unset), then `CHAT_MODEL` in `functions/_lib/chat/prompt.js` (`@`-prefixed = Workers AI `env.AI`; otherwise Gemini via Google's OpenAI-compatible endpoint + `GEMINI_API_KEY` secret) when OpenAI is unconfigured or fails/answers empty, then `CHAT_FALLBACK_MODEL` on Workers AI when both fail/answer empty (`chatAttempts` in `chat.js`) + lexical retrieval over a generated knowledge index + the **full** MCP tool surface via `callTool` (allowlist = all `TOOL_NAMES`; `character_id` pinned server-side). No web access.
- **Write gating (`functions/_lib/chat/actions.js`)**: reads run inline; the first **write** tool the model calls (annotation `readOnlyHint:false`) is *never executed inline* — it's captured, HMAC-signed into a short-lived token (reuses `JWT_SECRET`), and returned as a `pendingAction` the widget renders as a Confirm/Cancel card. Phase 2 (`{confirm:token}` body) verifies the token (signature/expiry/character), **charges the 1-credit action fee first** (`CHAT_ACTION_FEE`, atomic debit on `characters.credits` — before any execution or AI spend; refunded if the action errors), then executes via `callTool` and phrases the result. Confirm card shows the total credit cost incl. any skip (`actionCreditCost` = fee + `kill_boss`/`kill_raid`/`skip_hour`/`skip_slayer_task` skip credits). One fee per confirmed action regardless of how many updates it makes.
- Cost guards: messages are **unlimited** (the free Gemini primary is unmetered — pool `null`); only the PAID paths are budget-capped (reserve-then-settle; `functions/_lib/chat/quota.js`, migration 0027): OpenAI attempts meter a token pool (2.2M/day free data-sharing allotment — metered locally since overage bills), the Workers-AI fallback meters the neuron budget; an exhausted pool skips only its own attempts. A Gemini 429/503 retries with short backoff, then falls through. Any AI-path failure — budget exhausted, missing key, model error, time budget hit (`CHAT_TIME_BUDGET_MS` 45s, under the client's 60s fetch timeout), empty answer — → retrieval-only answer, never a bare apology. Tool calls run in parallel; a failing tool degrades to a `Tool error:` message the model can route around.
- Knowledge index: `npm run gen:knowledge` regenerates `functions/_lib/chat/knowledge.js` from `docs/game-guide.md` (player-facing; each `##` = one chunk) + `src/data/*.json`. Update guide + regenerate + commit when mechanics/content change.

## 17) Token efficiency (mandatory, every session)
In-session discipline mirroring Headroom's mechanical savings. Deviate only when the user asks for more detail.

**A) Output shaping** (the most-violated rule — obey literally):
- Lead with the answer/result. No preamble, postamble, or restating the question/plan/what you just did.
- Budget ≤6 lines for routine replies; post-edit status is 1–3 lines. Exceed only when asked, or when correctness needs a table/steps/code — then still cut dead sentences.
- Never echo context the user can see (file contents you edited, tool output, diffs, commands, their request) — point to it (`save.js:146`).
- No step narration, no closing recap, no unprompted "what I changed and why".
- One idea per line; cut filler. If a sentence survives deletion without information loss, delete it.

**B) Effort routing**: minimal reasoning on routine/mechanical work; deep reasoning only for novel/ambiguous problems.

**C) Intake reduction**: read narrowly (targeted `Grep`/`Glob`, `Read` with `offset`/`limit`); prefer `files_with_matches` before `content`; don't re-read files in context or re-derive known facts; batch independent calls; fetch on demand, not just-in-case.

**Local sessions only**: run `npm run claude:headroom` (`scripts/headroom-claude.sh`) for actual Headroom compression + output shaping (`HEADROOM_OUTPUT_SHAPER=1`; prereq `pip install "headroom-ai[all]"`; see `HEADROOM.md`). This wraps Claude Code at launch locally — it cannot reroute Claude Code Web/cloud sessions, so the rules above carry the load there. Don't commit `ANTHROPIC_BASE_URL` to shared settings.
