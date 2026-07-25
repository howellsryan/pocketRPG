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
- `api/**` HTTP endpoints (`/api/save`, `/api/actions/**`, `/api/pvp/**`, `/api/coop/**`, `/api/purchase`, `/api/mcp`, `oauth/**`, `stripe/**`) · `_lib/**` shared libs (`mcp/`, `oauth/`, `game/`, `pvpRanks.js`, `jwt.js`) · `.well-known/**` OAuth discovery.

**Other**: `migrations/` D1 SQL (`NNNN_name.sql`) · `tests/**/*.test.ts` Vitest · `scripts/` build/seed/maintenance · `docs/` design plans.

## 4) Gameplay Invariants
- Round with `Math.floor()`. Inventory cap = **28** slots. HP regen **+1/60s**.
- Auto-bank on full inventory; delay **5m (Agility 1) → 10s (Agility 99)**. Players can flag item *types* as excluded from auto-bank (toggle in the Inventory item modal; `autoBankExcludedItems` setting, `src/engine/idleEngine.js` `bankEverything`/`hasBankableItems`) — excluded items are skipped on every full-inventory bank trip (idle/offline/skip-hour/MCP) and never trigger an unproductive trip on their own.
- **Banked charges** (`charges` on a bank entry — trident/scythe/blowpipe/shardglass): the bank pools them into one scalar per itemId. On any bank rewrite an **absent `charges` field means "untouched"**, never zero — `preserveBankCharges` (`src/engine/bankCharges.js`) restores it inside `updateBank`, so forgetting the field preserves instead of destroys. Code that deliberately moves charges out of the bank must write an explicit number (0 included). Idle bank trips carry charges through: `bankEverything` tallies them into the sims' `chargesBanked` map, pooled onto the entry by `applyTaskResult`/`updateBankDirect` (players keep gear out of trips via `autoBankExcludedItems`, not the engine).
- Combat style: Accurate/Aggressive/Defensive **+3** relevant effective level; Controlled **+1** to attack/strength/defence.
- Dragonfire: **33% proc, max 50**, fully blocked by `otherBonus.antiDragon: true`.
- **Prayer (live PvE+PvP)**: drains a pool maxing at Prayer level; each prayer drains over time, higher tiers faster (`drainPerMinute` in `src/data/prayers.json`). Empty pool → prayers off. Pool starts full per session, persists across auto-fight kills. Prayer potion restores 20, super restore 22 (live+idle). PvP keeps protection prayers off (v1) so only offensive prayers drain. **Source of truth: `src/engine/prayerDrain.js`** (idle keeps its own pool in `src/engine/idleSupplies.js`).
- **Combo food**: combo consumables (flagged `combo: true`, e.g. Karam, plus every potion/brew) use a **separate combo cooldown** — one combo item may be used the same tick as one normal food, never delaying the next attack. See `isComboConsumable` in `src/engine/consumables.js`; honoured by `combat.js` (PvE) + `pvpEngine.js` (PvP).
- **Boss Slayer XP**: `BOSS_SLAYER_TASK_XP_MULTIPLIER` (×4) in `src/engine/slayerRewards.js`; avoid inflated explicit `slayerXP` on bosses (keep XP/hr ≤ ~2× best regular monster).
- **Slayer masters** live at world places (`placeId` in `src/engine/slayerMasters.js`, surfaced as worldContent's `slayer` activity kind). Getting a task is a place action — away from the master it opens the travel prompt; arrival auto-assigns via the Slayer screen (`initialMasterId`). Slayer point unlocks are bought on the Character Unlocks screen, not the Slayer screen.
- **Auto Slayer Task** (`auto_slayer_task`, 100-credit Character Unlocks purchase; server debit in `functions/api/unlocks/purchase.js`, owned-flag `characterUnlocks.autoSlayerTask` in the save): while idling *on* your assigned slayer monster, catch-up/skip re-assign the next task from the **same master** and keep simulating until the window (or supplies) run out, instead of farming the finished monster off-task. Chain lives in `src/engine/idleSlayerLoop.js` (`simulateIdleCombatChain` wraps `simulateIdleCombat` + its `stopOnSlayerComplete` option); it aggregates per-task points via `resolveSlayerLoopRewards` and per-monster kills/loot via `perMonster`. Rolled boss tasks can't be idled → the chain stops and leaves the boss task assigned (no reroll). Wired into the 3 client combat-sim sites only (boot `gameState.jsx`, visibility-return + skip-hour `App.jsx`); the MCP `idle` intent path is **not** chained. On modal close the idle-result handler resumes live combat on the new monster (`chainCombatResumeTarget` + monster-keyed `CombatScreen` remount) and teleports the player to its world place (`placesForActivity`) — the sim ignores travel, so arrival is instant; boss/death end-states don't auto-resume.
- **Kingdom of Royals** (Adventures screen, unlocked by quest `crown_complications`): deposit coins into a coffer (cap 25m, drains at a flat 5m/24h whenever any labour is allocated, ~5 days runtime) and allocate 4 labour points across Mining/Fishing/Woodcutting/**Farm Herbs** — the last is gated and tier-weighted by **Farming** level, not Herblore (`src/engine/kingdomResources.js` derives its ladder from `farming.json`'s herbs). Output is ordinary commodity resources (no uniques/credits) so it's **client-trusted** like idle catch-up, not server-authoritative — `src/engine/kingdomEngine.js` `simulateKingdom` runs independently of the active-task idle dispatch, keyed off its own `kingdom.lastTickAt` (boot, visibility-return, skip-hour, and a live 60s tick all call `settleKingdom`). Coffer drain is flat regardless of point count (funds the kingdom, not per-worker wages) — don't scale it by allocated points. Gathered output does **not** auto-bank: it accumulates in `kingdom.pendingLoot` (`mergeLoot` folds each settle's `itemsGained` in) and the player withdraws it manually from the Kingdom screen's loot modal (`withdrawAllLoot`) — don't wire `settleKingdom` back to `updateBankDirect`.
- **Construction unlockables + passive perks** (`UNLOCKABLES` in `src/engine/construction.js`, incl. the Lv 80 gather auto-bank perk) are bought/shown on the Character Unlocks screen, not the Construction screen — same pattern as Slayer point unlocks above. Gather auto-bank only applies during idle/offline catch-up and skip simulations; live gathering still stops on a full inventory.
- **Daily Tasks**: 5 tasks/day (one per tier: Novice → Grandmaster), reset **00:00 UTC**, **+1 credit** each. Server-authoritative grant via `/api/daily-tasks/complete` (idempotent `credited` flag + audit), **never** via `/api/save`. Issuance is lazy on `GET /api/daily-tasks`; durable table `character_daily_tasks` (migration 0025, outside the save blob). Cloud accounts only (mirrors credits pill). Event bus: `recordGameEvent(evt)` in `gameState.jsx`; matcher: `src/engine/dailyTasks.js`.
- **Journeys & teleports**: clues/quests run **only** as world-map journeys (`src/engine/journeys.js`; content granted on the final search; auto-chains next scroll / quest queue in `App.jsx`; legacy timer tasks still tick out). Per-place Magic teleports in `src/data/world.json` `teleport` (cities low — Varrick 25 — villages up to 87; always law runes; XP = level+10; `src/engine/teleports.js`); mid-journey teleports re-plan the walking leg, searches are pinned to their waypoint.

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
- Manual trigger only (`⚡ Special Attack`). No automatic/offline firing. Adding one → skill **`add-content`**.
- **The open world deliberately diverges**: energy is a persistent *session* resource there, never refilled by a fight ending or a kill — it only regenerates on the clock (`SPECIAL_REGEN_PER_TICK`, 10 per 30s, `world/server/tick.ts`). `player.specialEnergy` is the truth and is pushed onto the engine state each tick (`pinSpecialToSession`), because the shared engine still resets its own value on kills/phase resets. Don't "fix" the world back to the per-fight model above.

## 8) Drops & Data Authoring
Full authoring checklist (items, drops, specials, collection log, monsters) → skill **`add-content`**. Non-negotiables: every referenced item must exist in `src/data/items.json`; item names **Title Case**; new boss/raid/minigame/clue unique needs its `src/data/collectionLog.json` slot + regression test in the same change.
- **Armoury auto-listing**: the Armoury (`src/utils/armoury.js` → `ArmouryScreen`) lists every **equippable** item — anything with an equipment `slot` (`isEquippable`), combat gear or not (fishing rods, spades, cosmetics, prayer ammo included). New gear surfaces automatically once its `slot` is set (no registration), grouped by kind and filed under the type filter (Skilling/Melee/Magic/Ranged) via `typeFilterOf` — Skilling holds skill capes and **gathering-tool weapons** (a Dragon Axe requires Woodcutting; fishing nets/rods, pickaxes, spades via `isSkillingTool`), so Slayer/Dungeoneering-gated combat gear (chaotic weapons, slayer defenders/gloves) stays in Melee/Magic/Ranged. The item modal's "How to obtain" comes from `describeObtainment`, which reverse-indexes every source (craft/combine recipe, clue, raid, minigame, slayer-point/PvP-bot reward, thieving/hunter, monster drop; Trading Post as the trade-only fallback) — wiring a new item into any of those tables makes its source show up for free.

## 9) UI/Styling
- Min tap target **44×44px**. Prefer Tailwind utilities + `:root` CSS variables.
- Avoid inline `style={{}}` unless truly dynamic per render. No Tailwind `/N` opacity modifiers — use solid CSS variable colors.
- Reuse `src/components/` before new wrappers. New shared component → register in `build_single.cjs` `sourceFiles`; in-game screens also go in `GAME_CHUNK_FILES` (§12).

## 10) PvP
Server-authoritative under `/api/pvp/*`. Full rules (matchmaking, save-lockdown, special-energy/equip-swap timing, magic parity, bots) live in path-scoped rule **`.claude/rules/pvp.md`** (auto-loads on `functions/api/pvp/**`, `functions/_lib/pvp*`, `src/engine/pvp*`, `src/data/pvpBots.json`, `functions/api/leaderboard.js`). Tick model §6; prayer/combo §4.

## 11) Build/Test Commands (Authoritative)
- `npm test` → full Vitest. `npm run test:coverage` → same suite with v8 coverage (writes `coverage/`, gitignored). `npm run build` → `prebuild` (`npm test`) + `vite build`. `npm run rebuild` → `tsc` + single-file concat (`build_single.cjs`). `npm run check:single` → duplicate-identifier/syntax check + eval-time TDZ smoke-run of the bundle. `npm run ci` → `build` + `rebuild` + `check:single` (so `ci` **runs the full suite** via `build`'s prebuild). `npm run build:app` → Capacitor/iOS.
- No lint script — style is review + `check:single`.

**Commit gate (required)** — run `npm run ci` (it runs the full suite via `build`'s prebuild, then `typecheck` + `rebuild` + `check:single`). Don't commit with failing checks. Testing strategy, gates, and the feature→test map: **`TESTING.md`** + `.claude/rules/testing.md` (auto-loads on `tests/**`).

## 12) Single-file Build Safety
- `index.html` is generated by `build_single.cjs` and gitignored (`/index.html`, `/game-*.js`) — never edit/commit it; change `src/**`.
- Top-level declarations must be **globally unique** across both output files; duplicate-identifier errors are release-blocking. Prefer `src/utils/helpers.js`.
- **No eval-time cross-module reads**: the scripts run top-to-bottom in `sourceFiles` order, so a module's **top-level** `const`/`let` initializer must not read a binding another module exports (e.g. `const IDS = new Set(SLAYER_UNLOCKS.map(...))`) — if that module is concatenated first, the import is in its temporal dead zone → `Cannot access X before initialization`, which aborts the whole inline script and whites out prod. `node --check` can't see it; `check:single` now executes the bundle to catch it. Fix by deferring the read into a function (lazy init), never by reordering `sourceFiles`.
- **Code-split**: two CLASSIC scripts (not modules) — inline core in `index.html` + content-hashed `game-<hash>.js` (heavy in-game screens, `GAME_CHUNK_FILES`), loaded lazily on `cloudPhase === 'ready'` via `globalThis.__loadGameChunk`. Classic scripts share one global lexical env; cross-refs resolve by source name. Both minify with `minifyIdentifiers: false` — **do not re-enable**.
- New in-game screen → add to `sourceFiles` **and** `GAME_CHUNK_FILES`. Landing/auth-reachable screens stay **out** of `GAME_CHUNK_FILES`; core must not reference a chunk binding at module-eval time (only inside `renderScreen`).
- `gameIconsData` (~126 KiB) and `worldActivitiesData` (~150 KiB, `src/data/worldActivities.json`) are in the chunk. Core code guards every access (`typeof gameIconsData !== 'undefined'` + emoji fallback in icon code; `placeActivities()` in `src/engine/worldContent.js`) — **keep those guards**. World geography (`src/data/world.json`) stays in core.
- **3D rendering** (equip-screen hero + `CombatArena3D` inline combat panel — replaces the HP bars mid-fight, holds combat ticks until loaded via `onReady`): three.js vendored at `public/vendor/three/` (regen via `npm run sync:three`, never hand-edit), lazy-loaded as ES modules by `src/utils/three3d.js` — never bundled. Models: hero, weapons, and armour outfits are built from the CC0 Quaternius packs in `assets/open-world/Quaternius` into `public/3d-samples/` by `scripts/build-arena-hero.mjs` / `build-quaternius-weapons.mjs` / `build-quaternius-outfits.mjs` (universal rig; one grey-base GLB per weapon/outfit archetype, recoloured per metal tier by the registry `tint` at attach time — no Tripo in the hero path); monster GLBs may still come from R2 under `/api/tripo-assets/`; registry `src/data/equipmentModels.json` (`weapons` + `gear` + `monsters`; a `monsters` entry auto-enables the combat arena for that monster). Visual review: `node scripts/render-arena-hero.mjs --weapon <id> --gear <id,id>`. Gated at build time (baked as `pocketEnable3D`): `CF_PAGES_BRANCH` non-main → on, main/local → off; env `Enable3dRender` overrides; Vite dev always on + WebGL/reduced-data checks; paper doll is the universal fallback. Design/history: `docs/3d-gameplay-investigation.md`.

## 13) Agent Best Practices
- **Every implementation task starts with skill `delivery-loop`** (single-agent stepped delivery: triage, then Plan → optional Architect → Engineer / World Designer → QA inside this session; design record `docs/delivery-workflow.md`). Never spawn builder/QA agents; read-only Explore fan-out searches are the only sanctioned subagents. Pure questions/research are exempt.
- Keep changes minimal and scoped; no unrelated refactors — skill **`scope-fence`** (flag adjacent issues, don't fix them). Update logic tests with new gameplay logic.
- **Skills** (`.claude/skills/`, auto-trigger by description; full inventory + authoring guidance in **`SKILLS.md`**): `delivery-loop` (every implementation task), `plan-gate` (novel/multi-system work), `scope-fence`, `ruthless-editor` (public-facing prose), `memory-hygiene` (editing this file/rules), `pr-changelog` (every PR), `add-content` (game data), `procgen-creature` (creatures3d.json specs). Path-scoped rules live in `.claude/rules/` (pvp, mcp, chat, world-design — zone-authoring quality bar).
- **Comments: write very few.** Only for a non-obvious invariant/constraint the code can't express. Never narrate what code does, restate the change, or explain reasoning in comments — they cost tokens on every future read and go stale.
- Edit source of truth in `src/**` (+ `functions/**`); generated output follows from build scripts. Never commit `index.html` / `game-*.js`.
- Direct user/developer/system instructions outrank this file. Update this guide in the same change when it goes stale.

## 14) Production Security Model
Server is source of truth for everything that *can* be authoritative. The one deliberate exception: the save blob — no server-side engine recomputes the tick loop, so the client computes XP/coins/drops and the server trusts them. Know which side owns a thing before changing an endpoint.

**Server-authoritative (integrity boundary — never move to client/save):**
- **Identity & ownership** — auth (session JWT via `requireAuth`), characters, OAuth; every `/api/*` route verifies the token.
- **High-value grants** — boss/raid/clue/minigame/dungeoneering uniques granted by `/api/actions/**` (server-side loot RNG, kill-counts, collection-log, nonce replay protection). Save only carries the already-granted item.
- **Purchases** — `/api/purchase` debits coins + grants server-side. **Credits** — debited atomically by `/api/skip-hour`, `/api/slayer/skip`, and `/api/daily-tasks/complete`; **never** from `/api/save`. Skip-1h also covers travel/journeys: exactly one hour of trail time — longer journeys park mid-trail (never complete in full); time left after a completion chains further scrolls/queued quests.
- **Daily task credit grants** — `/api/daily-tasks/complete` atomically flips `credited=0→1` (idempotency key) then increments `credits`; replay returns `creditsGranted: 0`. PvP-lockdown enforced.
- **PvP settlement / trading post** — own server-authoritative paths (§10).
- **Co-op boss fights** (`/api/coop/**`, §20) — the server resolves every swing, so XP, supply consumption and the kill's loot roll/grant are all authoritative, not save-blob.
- New economy/progression mutations must emit **audit events** (`functions/_lib/game/audit.js`).

**Client-trusted (the save blob — deliberate, bounded):**
- Live skilling, idle/offline catch-up, skip-hour compute XP/coins/drops client-side and persist via `/api/save`. XP/coins + client-created items (idle/offline loot, crafted/smithed/cooked products, skill capes) ride the trusted blob since those paths legitimately create them and the server has no engine to re-derive them.
- Leaderboard is best-effort, not cheat-proof. Do **not** add `/api/save` checks policing economy/item *increases* — they break the core loop and buy no real protection. Tighten integrity by moving a reward onto a server-authoritative endpoint, not by validating the save.
- `/api/save` enforces exactly **two** anti-cheat-adjacent guards (integrity, not anti-cheat): stale-write rejection (`save_revision`) and total-level regression guard (refuses a save whose total level drops below stored; `functions/_lib/game/saveValidation.js`). Separately, saves are **locked** entirely during an active PvP match, during an active co-op boss session (§20), and during a live open-world session (`world_sessions`, migration 0030; `functions/_lib/game/worldSessions.js`) so the companion app and idle game never write the same save at once — the world DO holds the lock (begin on hello, heartbeat refresh, clear on disconnect; TTL self-heals a dead DO) and the world's own grant flush is the sole path that mutates the save while it's held. World entry (`/api/world-token`, world session exchange, DO hello) and the world grant flush also reject an active PvP match.

## 15) MCP Server (`/api/mcp`)
Stateless MCP server (JSON-RPC 2.0) at `functions/api/mcp.js` with its own OAuth 2.1 server. Architecture + how-to-add-a-tool (bridge tools vs save-intents, the `schema.js`/`tools.js`/test trio, `applyTaskResult.js` as single source of truth) live in path-scoped rule **`.claude/rules/mcp.md`** (auto-loads on `functions/api/mcp.js`, `functions/_lib/mcp/**`, OAuth paths, `src/screens/OAuthConsentScreen.jsx`, `tests/mcp*.test.ts`).

## 16) Help Chatbot (`/api/chat`)
In-game helper (floating 💬) that answers questions **and performs account actions** via the MCP tool surface. Full architecture (model fallback chain, progressive tool exposure, HMAC-gated writes + 1-credit action fee, daily message/spend budgets, knowledge index) lives in path-scoped rule **`.claude/rules/chat.md`** (auto-loads on `functions/api/chat.js`, `functions/_lib/chat/**`, `src/components/ChatWidget.jsx`, `docs/game-guide.md`). Player-visible mechanics change → update `docs/game-guide.md` + `npm run gen:knowledge` + commit.

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

## 18) Design Context
`PRODUCT.md` (repo root) is the strategic design brief (register, users, brand personality, anti-references, design principles); `DESIGN.md` (repo root) is the visual language — base parchment/gold/void palette + the piloted FORGEMARK `fm-*` kit, both tokenised in `src/index.css` `:root`. Read both before any UI/UX design work and keep `DESIGN.md` in sync when tokens/kit change. The `/impeccable` skill payload is not yet vendored (`.github/hooks/impeccable.json` expects `.github/skills/impeccable/`) — install via `npx impeccable skills install` locally and commit.

## 19) PR titles & bodies are the public changelog
Merged PR title + body auto-post verbatim to the players' Discord `#changelog`. Voice, structure, and cutting pass → skill **`pr-changelog`** (fires on every PR write). Non-negotiable even without the skill: player-facing voice, and **never** any attribution, AI/Claude mention, session/GitHub link, secret, or internal note in the title or body. The common leak is a commit trailer (`Co-Authored-By`, `Claude-Session`) bleeding into the PR body — keep those in commits only, never the body. There is **no automated backstop**: the changelog workflow only strips `<!-- -->` comments, so whatever is in the PR title/body publishes verbatim. Getting this right is on the PR author.

## 20) Co-op Boss Fights (`/api/coop/**`)
Several players versus one shared boss, in the idle game. **Allowlisted per boss** (`COOP_BOSSES` in `src/engine/coopBossEngine.js` — `corporeal_horror`, `warlord_grondar`); each boss needs its mechanics checked against the shared-HP model before it opens up, and carries its own `respawnTicks`. Pace that off the boss's HP, not a flat default: a group melts a low-HP boss far faster than a solo player, so a squishy boss needs a longer wait between kills to stay inside the §4 GP/XP-per-hour guardrails (Grondar is 255 HP → 50 ticks; the Horror is 2000 → 10).
- **Picking solo vs group**: tapping an allowlisted boss in the combat picker opens a choice prompt (`coopChoice` in `CombatScreen.jsx`) — solo runs the normal client-side fight, group joins a server session. Any other entry point into `startFight` (auto-start, slayer, dungeon) stays solo.
- **The group fight must look like the solo fight.** `CoopBossScreen` renders the same mobile HUD as `CombatScreen` — back link, fight header, HP blocks, prayer bar, `CombatQuickActions`, `cb-actions` row — and the shared blocks live in `src/components/CombatHud.jsx` so the two cannot drift. Add HUD markup there, not to one screen. A kill shows the same `LootResultModal` as a solo boss (shaping shared via `src/utils/lootModal.js`) to the loot winner only, and the respawn wait shows as a live countdown. Deliberately absent: any damage/contribution leaderboard (loot attribution is server-side and not the player's to manage mid-fight) and any Leave button beyond the standard back link. Server-side gaps show as parity gaps, so every quick-action needs its intent: `equip` enforces level/quest gates against the `levels`/`completedQuests` the member carries from join (fails **closed** — a session predating those fields equips nothing gated) and refuses rather than drops gear when a 2H swap won't fit the pack.
- **Transport mirrors PvP**: D1 `coop_boss_sessions.state_json` + `current_tick`, advanced by whichever member's polled `POST /api/coop/session/[id]/tick` arrives first in a 600ms window (optimistic concurrency on `current_tick`); actions queue as validated rows in `coop_intents`. Migration 0031.
- **Combat mirrors the open world** (`world/server/combat.ts`): each member runs their own `processCombatTick` session against the shared boss HP, so authored boss mechanics keep working. Two invariants — only the **target** member's session resolves a boss swing (otherwise the boss attacks once per member), and only the target advances the **add's** spawn countdown (otherwise N members each spawn one).
- **Loot** goes to the top-damage contributor (`topDamageCharacterId`; ties → whoever got there first), rolled and granted server-side with the same collection-log/kill-count/audit side-effects as `/api/actions/monster/complete`. Attribution is the boss's HP delta across a member's tick, so every damage source counts.
- **Instances are sharded**, capped at `COOP_MAX_MEMBERS` (8): joining picks the fullest non-full session, else opens a new one — never one global boss per boss id.
- **The save is locked** while a session is live (`characters.active_coop_session_id`; same lock class as PvP and world). The server owns inventory/XP/HP from join until leave, and `leaveCoopSession` writes them back — so the client must pull the save on exit, never push its own.
