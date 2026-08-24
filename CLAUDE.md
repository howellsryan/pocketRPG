# CLAUDE.md — PocketRPG Contributor Guide

> Accurate, terse instructions for AI/human contributors, loaded every session. When behaviour or scripts change, update this file in the same change. Keep it short — it's input-token cost on every session.

## 0) Orientation
- **Product**: menu-driven, tick-based, mobile-first fantasy **idle RPG**. Deterministic core; client runs the game loop locally and syncs to a server that is the source of truth for accounts, high-value grants, and competitive/social systems (§14).
- **Code**: client in `src/`, Cloudflare server in `functions/` behind the router in `worker/`, content in `src/data/`, tests in `tests/`.
- **Build**: deployed app is a generated, gitignored `index.html` + lazy `game-<hash>.js` (§12). Edit `src/**`, never the generated output.
- Pass the §11 commit gate before committing. §17 (token discipline) applies to every session.

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
- Round with `Math.floor()`. Inventory cap = **28** slots. HP regen **+1/60s**.
- Combat style: Accurate/Aggressive/Defensive **+3** relevant effective level; Controlled **+1** to attack/strength/defence.
- Dragonfire: **33% proc, max 50**, fully blocked by `otherBonus.antiDragon: true`.
- The rest of the engine's gameplay invariants (holdings/banking, quest gates, prayer/combo, boss adds and shared-record combat, world minions, hard mode, Grim Reaper, Slayer, Kingdom of Royals, Construction unlocks, Daily Tasks, journeys/teleports) are a path-scoped rule, not here: **`.claude/rules/gameplay-engine.md`** (auto-loads on `src/engine/**` and its server-side mirrors). Read it before touching any of those systems.

## 5) XP & Leveling
- Levels **1–99**. XP cap **200,000,000**.
- `totalXP(L) = floor(sum(x=1..L-1, floor(x + 300 * 2^(x/7)) / 4))`.
- Starting HP level **10** (1,154 XP).
- Gains: Combat **4 XP/damage** to primary skill, **1.33 XP/damage** to HP. Magic: base spell XP + **2 XP/damage**.
- **"How many X to level N" is `src/engine/trainingPlanner.js`**, never arithmetic in a caller — it walks the ladder picking the best option per level, applies the account XP cut and the gates outside the trained skill (gilded altar → Construction 75), and is what the `plan_training` MCP tool and the helper (§16) answer from. Only skills with a repeated-action ladder are plannable (`plannableSkillIds()`); Farming, Slayer and the combat skills have none and it refuses rather than guessing.

## 6) Combat Tick Model
- Tick **600ms**.
- Melee max hit: `floor(0.5 + effectiveStr * (bonus + 64) / 640)`.
- Accuracy: `maxRoll = effectiveLevel * (bonus + 64)`; if `attackRoll > defRoll`: `1 - (defRoll + 2)/(2*(attackRoll + 1))`, else `attackRoll/(2*(defRoll + 1))`.
- Auto-fight restart delay after kill: **1.2s**.
- **`src/engine/dpsCalculator.js` is the analytical twin of `processCombatTick`'s player-attack branches** (expected damage in place of the roll), and `gearOptimizer.js` searches loadouts with it — both consumed by the `analyze_dps` MCP tool (§15) and the helper (§16). Change a player-damage branch in `combat.js` and change the matching branch there in the same edit, or the helper recommends gear by maths the fight doesn't use. `tests/dpsCalculator.test.ts` pins the two together by simulating swings against the estimate, so drift fails the build rather than shipping a confidently wrong answer. Enchanted bolt procs, Dharok's HP scaling and special attacks are deliberately unmodelled and declared in the payload's `notes`.
- **Only a raid completion stops the game on the full-screen `LootResultModal`** (`killPresentsFullModal`, `src/utils/lootModal.js`) — a standalone boss kill flashes its loot as a reward-reveal card (`emitKillReveal`) same as an ordinary kill, and re-arms itself after the delay above; a boss no longer needs a tap-through per kill either. A server-authoritative kill (boss, or a non-boss with a collection-logged drop) simply holds the fight for the round trip before the card fires — that hold is also what stops two `completeMonster` calls overlapping. A reveal card whose loot contains a legendary item (`hasEpicLootDrop`, unit value ≥ 1m — same predicate the raid modal's purple theme uses) renders purple instead of gold, and a merged card stays purple once any absorbed kill was epic.

## 7) Special Attacks
- PvE special energy (`combatState.specialAttackEnergy`) **0–100**: starts each fight at 100, drains on use, refills on kill.
- Manual trigger only (`⚡ Special Attack`). No automatic/offline firing. Adding one → skill **`add-content`**.
- **The open world deliberately diverges**: energy is a persistent *session* resource there, never refilled by a fight ending or a kill — it only regenerates on the clock (`SPECIAL_REGEN_PER_TICK`, 10 per 30s, `world/server/tick.ts`). `player.specialEnergy` is the truth and is pushed onto the engine state each tick (`pinSpecialToSession`), because the shared engine still resets its own value on kills/phase resets. Don't "fix" the world back to the per-fight model above.
- **Master Rejuvenation** (`master_rejuvenation`, the Lv 90 Construction perk) **refills** the bar to 100 the moment it empties — `refillSpecialOnEmpty` (`src/engine/specialRegen.js`), called by all three contexts that own a copy of the energy: solo (`CombatScreen`, mid-fight only), every co-op/raid member (`processCoopTick`, in every phase — lobby and respawn wait are prep time), and the world (`tickPlayer`). The flag is read from `settings.unlockedFeatures` once per context (client Set, co-op member at join, world player at hello). **The Wilderness is the one place it is off** (`ctx.pvpZone` from `isPvpZone`, §10) — a bar that comes back free decides a duel by who owns a perk. **Empty means the bar READS 0% (`energy < 1`), not an exact zero** — solo and co-op hold whole points, but the world's energy carries the fraction of its 0.2/tick clock regen and a flat cost off 50.2 leaves 0.2, so `=== 0` fires approximately never out there. For the same reason the world applies it BEFORE the clock regen, on the same tick `stepCombat` spends.

## 8) Drops & Data Authoring
Full authoring checklist (items, drops, specials, collection log, monsters) → skill **`add-content`**. Non-negotiables: every referenced item must exist in `src/data/items.json`; item names **Title Case**; new boss/raid/minigame/clue unique needs its `src/data/collectionLog.json` slot + regression test in the same change.
- **Armoury auto-listing**: the Armoury (`src/utils/armoury.js` → `ArmouryScreen`) lists every **equippable** item — anything with an equipment `slot` (`isEquippable`), combat gear or not (fishing rods, spades, cosmetics, prayer ammo included). New gear surfaces automatically once its `slot` is set (no registration), grouped by kind and filed under the type filter (Skilling/Melee/Magic/Ranged) via `typeFilterOf` — Skilling holds skill capes and **gathering-tool weapons** (a Dragon Axe requires Woodcutting; fishing nets/rods, pickaxes, spades via `isSkillingTool`), so Slayer/Dungeoneering-gated combat gear (chaotic weapons, slayer defenders/gloves) stays in Melee/Magic/Ranged. The item modal's "How to obtain" comes from `describeObtainment`, which reverse-indexes every source (craft/combine recipe, clue, raid, minigame, slayer-point/PvP-bot reward, thieving/hunter, monster drop; Trading Post as the trade-only fallback) — wiring a new item into any of those tables makes its source show up for free.

## 9) UI/Styling
- Min tap target **44×44px**. Prefer Tailwind utilities + `:root` CSS variables.
- Avoid inline `style={{}}` unless truly dynamic per render. No Tailwind `/N` opacity modifiers — use solid CSS variable colors.
- Reuse `src/components/` before new wrappers. New shared component → register in `build_single.cjs` `sourceFiles`; in-game screens also go in `GAME_CHUNK_FILES` (§12).
- **Read `DESIGN.md` before writing any CSS** (§18) — screens are skinned twice (`.cb-*` iron base + `.forge-shell` parchment override), so a neighbouring rule is never a colour template. Build new surfaces from existing screen classes + `fm-*` kit primitives; a new class of your own carries layout only. `DESIGN.md` §2, the Two-Skin Trap.
- **Themes and item-icon resolution**: path-scoped rule **`.claude/rules/ui-styling.md`** (auto-loads on `src/utils/theme.js`, `src/utils/itemIconResolve.js`, `src/index.css`, and related files).
- **On-screen action animation** (combat swings, skilling motions, monster art): skill **`action-animation`** + `docs/action-animations.md` — timing law, the two live stages, why skilling scales strike count not tempo, and the event-to-swing contract.

## 10) PvP — the Wilderness (open world only)
PvP is **one open-world zone** (`wilderness`), entered from the Combat screen's card → `openWorld(api, 'wilderness')`. There is no lobby and no duel: `/api/pvp/*`, `PvpMatchRoom` and the `pvp_matches`/`pvp_waiting_room`/`pvp_invitations` tables were deleted in migration 0035 once the zone shipped — **don't rebuild a second PvP path**, `world/shared/pvpArea.ts` is the only gate. Safe camp with a bank chest in the south, a walled line with three gates, open PvP north of it. ±10 combat bracket, single combat, protection prayers live, **death drops pack AND worn gear**. Ironman **and Grindman** may fight and keep bot drops but never player drops (`takesOwnLootOnly` in `world/server/loot.ts` is the one funnel for both, and for all floor loot they don't own); One Life ends there like anywhere else. Roaming bots (`src/data/pvpBots.json` templates) are the offline opponent and the only Zesta source, and exist only while a player is north of the line. Full rules → path-scoped rule **`.claude/rules/pvp.md`** (auto-loads on `src/engine/pvp*`, `world/server/pvp*`, `world/shared/pvpArea.ts`, `src/data/pvpBots.json`, `functions/api/leaderboard.js`). Tick model §6; prayer/combo `.claude/rules/gameplay-engine.md`.

## 11) Build/Test Commands (Authoritative)
- `npm test` → full Vitest. `npm run test:coverage` → same suite with v8 coverage (writes `coverage/`, gitignored). `npm run build` → `prebuild` (`npm test`) + `vite build`. `npm run rebuild` → `tsc` + single-file concat (`build_single.cjs`). `npm run check:single` → duplicate-identifier/syntax check + eval-time TDZ smoke-run of the bundle. `npm run ci` → `typecheck` + `build` (**runs the full suite** via its `prebuild`) + `rebuild` + `gen:guide` + `check:single` + `gen:weapon-preview -- --check` + `gen:monster-preview -- --check`. `npm run build:app` → Capacitor/iOS.
- No lint script — style is review + `check:single`.

**Commit gate (required)** — run `npm run ci`; it is the full authoritative gate above. Don't commit with failing checks. Testing strategy, gates, and the feature→test map: **`TESTING.md`** + `.claude/rules/testing.md` (auto-loads on `tests/**`).

## 12) Single-file Build Safety
`index.html` is generated by `build_single.cjs` and gitignored (`/index.html`, `/game-*.js`) — never edit/commit it; change `src/**`. Full build-safety rules (eval-time TDZ traps, code-split/chunk rules, the 3D/GLB asset pipeline): path-scoped rule **`.claude/rules/single-file-build.md`** (auto-loads on `build_single.cjs`, `src/3d/**`, and related 3D asset scripts).

## 13) Agent Best Practices
- **Every implementation task starts with skill `delivery-loop`** (single-agent stepped delivery: triage, then Plan → optional Architect → Engineer / World Designer → Code Review → QA inside this session; Code Review loops back to Engineer on FAIL until it passes, then QA runs; design record `docs/delivery-workflow.md`). Never spawn builder/QA agents; read-only Explore fan-out searches are the only sanctioned subagents. Pure questions/research are exempt.
- Keep changes minimal and scoped; no unrelated refactors — skill **`scope-fence`** (flag adjacent issues, don't fix them). Update logic tests with new gameplay logic.
- **New project-specific knowledge defaults to a path-scoped rule, not this file.** This file loads in full on **every** session regardless of what's being touched, so it costs tokens even on a session doing UI copy or a docs-only change; a `.claude/rules/*.md` file only loads when its `paths:` frontmatter matches what the session is working on. Before adding a dense, subsystem-specific paragraph here, ask: does an existing rule already cover this path (extend it) — if not, does the fact only matter when touching a specific file/directory (new rule, scoped narrowly) — reserve growing *this* file for orientation, build commands, and workflow discipline that's relevant no matter what's being worked on. When a rule/skill supersedes lines here, delete them in the same change (below).
- **Skills** (`.claude/skills/`, auto-trigger by description; full inventory + authoring guidance in **`SKILLS.md`**): `delivery-loop` (every implementation task), `plan-gate` (novel/multi-system work), `scope-fence`, `ruthless-editor` (public-facing prose), `memory-hygiene` (editing this file/rules), `pr-changelog` (every PR), `add-content` (game data), `action-animation` (on-screen animation for a player action), `procgen-creature` (creatures3d.json specs), `save-item-grant` (hand-edit an item into a character's D1 save via `scripts/grant-save-item.mjs`). Path-scoped rules live in `.claude/rules/`: `gameplay-engine` (`src/engine/**` invariants), `coop-raids` (`/api/coop/**`), `server-authority` (`functions/api/**`/`functions/_lib/**` security model), `ui-styling` (themes/icons), `single-file-build` (`build_single.cjs` + 3D pipeline), `pvp`, `mcp`, `chat`, `world-design` (zone-authoring quality bar), `testing`, `video` (the `video/**` clip pipeline).
- **Comments: write very few.** Only for a non-obvious invariant/constraint the code can't express. Never narrate what code does, restate the change, or explain reasoning in comments — they cost tokens on every future read and go stale. **`migrations/*.sql` take NO comments at all** — the file gets pasted into the D1 console by hand; rationale belongs in the code that reads the table.
- Edit source of truth in `src/**` (+ `functions/**`); generated output follows from build scripts. Never commit `index.html` / `game-*.js`.
- Direct user/developer/system instructions outrank this file. Update this guide in the same change when it goes stale.

## 14) Production Security Model
Server is source of truth for everything that *can* be authoritative. The one deliberate exception: the save blob — no server-side engine recomputes the tick loop, so the client computes XP/coins/drops and the server trusts them. Know which side owns a thing before changing an endpoint. Full model (every server-authoritative surface, the admin portal, audit events, item-loss safety net, save-lock mechanics): path-scoped rule **`.claude/rules/server-authority.md`** (auto-loads on `functions/api/**`, `functions/_lib/**`, `worker/**`).
- **Server-authoritative, never move to client/save**: identity/auth, high-value grants (boss/raid/clue/minigame/dungeoneering uniques), purchases, credits, daily-task credit grants, Wilderness settlement/trading post, co-op boss fights, admin grants.
- **Client-trusted (the save blob)**: live skilling, idle/offline catch-up and skip-hour compute XP/coins/drops client-side. **Never add `/api/save` checks policing economy/item increases** — they break the core loop and buy no real protection; tighten integrity by moving a reward onto a server-authoritative endpoint instead.
- `/api/save` enforces exactly **three** anti-cheat-adjacent guards (stale-write rejection, total-level regression, bank-wipe). Saves are also **locked** entirely during an active co-op session (§20/§21) or a live open-world session.

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
Several players versus one shared boss, in the idle game — a server-authoritative Durable Object session (`CoopBossRoom`) with loot shared across everyone who reaches a 10% damage threshold. Full mechanics, invariants and traps (the WebSocket push protocol, save-lock/heartbeat rules, kill-settlement idempotency, chat/loot broadcasts): path-scoped rule **`.claude/rules/coop-raids.md`** (auto-loads on `functions/api/coop/**`, `world/server/CoopBossRoom.ts`, and the co-op client/engine files).

## 21) Raid Parties (`/api/coop/raid/**`)
A raid run as a co-op session (§20 is the substrate — same room, same tick, same save lock, same 10% loot gate), with a lobby, host-started run, and one payout at the end across the whole run. Full mechanics: the same **`.claude/rules/coop-raids.md`** rule as §20.
