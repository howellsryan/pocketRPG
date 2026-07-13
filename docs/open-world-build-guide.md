# Open-World Client — Step-by-Step Build Guide for the Builder Agent

> This document is the **authoritative build spec** for the PocketRPG open-world companion game. It is written for an AI builder agent working inside this repo with a human developer (the repo owner) available asynchronously. Strategy/rationale live in `docs/open-world-companion-game-plan.md`; where the two differ on phasing or scope, **this guide wins**.

---

## 0) Rules for the builder agent — read first, obey always

1. **Execute steps in order.** Do not skip, merge, reorder, or parallelize steps unless a step explicitly says so. Do not start a phase until the previous phase's acceptance checklist is confirmed by the developer.
2. **Anything marked `DECIDED` is final.** Do not redesign it, "improve" it, or substitute libraries/patterns. If a DECIDED item appears impossible (API removed, file missing, version conflict), **STOP and raise a DEVELOPER TASK** (format below) instead of improvising.
3. **Do not assume — verify in-repo.** Every step lists the exact files to read before writing code. If a referenced function/file doesn't match what this guide says, stop and report the discrepancy; do not guess an alternative.
4. **Scope is frozen.** No sound, no extra skills/monsters/zones beyond what a phase names. (Several original freezes have since been lifted by explicit developer decision and are now built: mobile support, chat + other players (Phase 3), a **minimap** and an **in-world HUD panel with running/stances/special-attack/logout** (2026-07). Treat those as live features, not scope creep.) If you notice something else "missing", it is out of scope on purpose.
5. **CLAUDE.md still applies** (token discipline, minimal comments, never commit `index.html`/`game-*.js`, commit gate for `src/**`/`functions/**` changes).
6. **Maintain a progress log** at `docs/world-progress.md`. After completing each step append one line: `- [x] STEP <id> — <commit sha> — <one-line note / deviations>`. Sessions resume from this log; never re-do a step marked done without developer instruction.
7. **DEVELOPER TASK protocol.** When you hit anything in §2's "developer-only" list, output a block in your reply exactly like this, then continue with any steps that don't depend on it (or end the turn if blocked):

   ```
   ── DEVELOPER TASK DT-<n> ──────────────────────
   Blocking: STEP <id>
   What I need you to do: <numbered, copy-pasteable instructions>
   How I'll know it's done: <observable check the agent can run>
   ───────────────────────────────────────────────
   ```
8. **Hard prohibitions** (never do these, no exceptions):
   - Never copy code, data, assets, maps, models, or names from Jagex games, OSRS wikis, or Lost City/2004Scape **content**. (Reading Lost City's MIT server *code* for reference is allowed; copying its game *content* is not.) All mechanics numbers come from this repo's `src/data/*.json` and `src/engine/*`.
   - Never write to D1 or DO storage inside the per-tick loop. Durable writes happen only at the checkpoint/flush points this guide names.
   - Never change gameplay semantics of existing `src/engine/*` code. Extraction/refactor commits must keep every existing test green and add equivalence tests.
   - Never modify the existing Pages deployment config, `build_single.cjs`, or `wrangler.toml` at repo root (adding a root npm script is allowed only where a step says so).
   - Never commit secrets, `.dev.vars`, `world/node_modules`, `world/client/dist`.

---

## 1) DECIDED — fixed decisions table

| Topic | Decision |
|---|---|
| Product | Point-and-click open-world companion client. **All viewport sizes, including mobile** (reversed 2026-07 — the original desktop/tablet-only gate and its block page have been removed by developer decision). Known gap: `updateCamera`'s zoom only responds to `wheel`, which mobile browsers never fire — no pinch/gesture zoom exists yet. |
| Input | OSRS-style: **left-click = default action** on the thing under the cursor; **right-click (desktop) / long-press ≥500 ms (touch)** opens a context menu of all actions. Spec in §8. |
| Client stack | Vite + TypeScript + **three.js (npm package, pinned to the same version as `public/vendor/three/`)** . No React/Preact in the world client — plain TS + DOM for UI panels. |
| Server stack | One Cloudflare **Worker** (`pocketrpg-world`) serving static client assets + `/api/world/*` HTTP + a **Durable Object class `WorldZone`** built on **`partyserver`** (npm, MIT, Cloudflare-maintained). Client WS via **`partysocket`**. |
| Tick | 600 ms, same as PocketRPG. In-memory `setInterval` in the DO while ≥1 player connected; interval stopped when zone empties. |
| Data | Same D1 database as PocketRPG (binding `DB`, `database_id 439e810b-8dce-4697-94c2-a7392520ad8f`). World-only tables via new migrations. Character progression lives in the existing save blob; the world touches it **only** through the grant-flush path (§7.6). |
| Auth | Existing session JWT + `JWT_SECRET`. Handoff: PocketRPG calls `POST /api/world-token` → 60 s single-purpose JWT → world app exchanges it at `POST /api/world/session` for a 24 h world-session JWT (§6.3). |
| Shared code | Import `src/engine/*`, `src/data/*.json`, `functions/_lib/jwt.js`, `functions/_lib/game/*` via **relative paths** from `world/`. Never duplicate a formula or a data table. |
| Movement | Tile grid, 1 three.js unit = 1 tile. 8-directional, no corner-cutting through blocked tiles. Walk = 1 tile/tick; **running added 2026-07 (developer decision, reverses "walk only")** — a run toggle (`{t:'setRun'}`) moves 2 tiles/tick and drains a 0-100 run-energy bar that regenerates while walking/idle (`RUN_DRAIN_PER_TILE`/`RUN_REGEN_PER_TICK` in `world/server/tick.ts`; `{e:'run'}` echo). Server-side A\* pathfinding, max path length 64. Client interpolates between tick positions. |
| Phase 1 skill | **Mining** — rocks `tin` and `copper` from `src/data/skills.json` → `mining.actions` (level 1, 4 ticks/ore, 17 XP, products `tin_ore`/`copper_ore`). PocketRPG semantics: deterministic ticks-per-ore, **no success RNG**. |
| Phase 2 monster | **`pasture_bull` only** (PocketRPG's cow: `legacy_id: "cow"`, 8 HP, attackSpeed 4, drops Bones + Raw Beef + Cowhide @100%, medium clue @2%). Combat runs `createCombatState` + `processCombatTick` from `src/engine/combat.js` — **no reimplemented combat math**. |
| Floor loot | On kill: drops become ground items at the death tile. Owner-only for 100 ticks, visible to everyone after, despawn at 300 ticks. `Take` adds to the 28-slot session inventory. |
| Grants | Batched per player in DO memory; flushed to the save blob on: bank-chest deposit, disconnect, zone leave, or 60 s timer (timer = XP only). Idempotency row per flush + audit event. **Inventory-first (reversed 2026-07)**: the session pack seeds from the character's PocketRPG inventory at hello; world-minted items land in the save **inventory** on disconnect (overflow → bank); a chest deposit banks the whole pack (moving save-backed units inventory→bank, minting the rest straight to bank). |
| Zone | One hand-authored zone `pasture` (32×32 tiles) for all three phases. Format in §6.5. |
| Domain | `world.pocketrpg.co.uk` (custom domain on the Worker; workers.dev URL until DNS is set). |
| Deploys | Manual by developer: `cd world && npx wrangler deploy`. No CI wiring in v1. |
| Entry point | A "Enter World (beta)" button in PocketRPG's Settings screen, hidden unless `localStorage.pocketWorldBeta === '1'`, so it can merge to main without player exposure. |
| Branch/PRs | All work on branches named `world/<phase>-<topic>`. Developer opens/merges PRs. PR bodies follow CLAUDE.md §20 — for pre-release world work use one honest chore line ("Internal: experimental world client groundwork, not yet player-visible"). |

---

## 2) Capability boundaries — what the agent must hand to the developer

The builder agent runs in a sandboxed cloud session. It **can**: edit files, run `npm`/`vitest`/`tsc`/`vite build`, run `wrangler dev` locally (Miniflare simulates the DO + a *local* D1), run headless Chromium via Playwright, commit, and push.

**Agent self-verification (proven 2026-07 — do this before every hand-off, it catches real bugs):**
- **Protocol/E2E**: `npm run dev:seed` + `wrangler dev`, then drive the WS protocol from a plain Node script (`hello` → `walk`/`interact` → assert diffs/events) and assert final state with `wrangler d1 execute … --local --json`. This validated the whole mine→flush→save pipeline without a browser and is the primary acceptance path for server work; DT-class B manual scripts then only need to cover look/feel and real-device input.
- **Visual**: headless Chromium WebGL works reliably with `chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })` (install Playwright with `npm i --no-save playwright` — keep it out of package.json). Screenshots through the real client found the Phase 0 mirrored-ground bug that code review missed. Playwright's `page.on('websocket')` frame logging shows exactly what a click sent.
- **Gotcha**: the local D1 sqlite is locked while `wrangler dev` runs — stop it (`pkill -f '[w]rangler dev'; pkill -f '[w]orkerd'`; plain patterns match your own shell) before `dev:seed` or any `d1 execute`, then restart.

It **cannot** (always a DEVELOPER TASK):
- **DT-class A — Cloudflare account actions**: first `wrangler deploy` of the new Worker, setting the `JWT_SECRET` secret (`cd world && npx wrangler secret put JWT_SECRET` — must be the **same value** as the Pages project's), adding the `world.pocketrpg.co.uk` custom domain, applying D1 migrations to production (`npx wrangler d1 migrations apply pocketrpg --remote` from repo root), confirming the Workers paid plan is active.
- **DT-class B — Real-device verification**: every phase ends with a manual test script the developer runs in a real browser (desktop + one tablet). The agent must never mark a phase accepted on its own.
- **DT-class C — Asset acquisition**: downloading NEW packs the in-repo library (§2.1) doesn't already cover (agent network is proxied/limited). The developer downloads and drops files; the agent processes them. Check §2.1 first — most needs are already met.
- **DT-class D — Product judgement calls**: anything this guide leaves open (it tries to leave nothing open). When in doubt → DEVELOPER TASK, not a guess.

### 2.1 Asset library — `assets/open-world/` (git-tracked, ~13k files / 1.2 GB)

Source 3D assets from here FIRST; DT-class C is only for gaps. Nothing under `assets/` ships to players directly — process/copy what a step needs into `world/client/public/models/` (small, committed) or R2. Prefer `gltf`/`glb` variants; `fbx` folders are Unity/Blender sources. KayKit + Kenney packs are CC0; Quaternius `[Standard]` packs are paid-license (fine to use in the game, don't redistribute as raw assets).

**Vendor steering (developer decision 2026-07)**: anything that must attach to or share a rig with the hero (outfits, equipment visuals, future player characters) comes from **Quaternius** — the hero is on the Quaternius universal rig precisely so those packs layer on. KayKit/Kenney are for props, scenery, buildings, and standalone NPCs. Quaternius `[Standard]` packs ship 4K PBR textures — always strip/shrink like `build-hero.mjs` does before committing a processed model. The pre-assembled `Outfits/*.gltf` exports are complete outfitted characters; the `Modular Parts/` folder has the same pieces separately for mix-and-match later.

| Vendor | Packs | Use for |
|---|---|---|
| `kaykit/` | Adventurers 2.0 (Knight/Barbarian/Ranger/Rogue/Mage, rigged `Rig_Medium`), Character Animations 1.1 (General/MovementBasic/MovementAdvanced/Tools/CombatMelee/CombatRanged/Simulation/Special clip GLBs for Rig_Small/Medium/Large + mannequins), Skeletons, Halloween Bits, Dungeon Remastered (chests, props, dungeon kit), Medieval Hexagon + Medieval Builder (buildings, hex terrain), Forest Nature Pack, ResourceBits (ore nuggets, bars, logs) | Player/NPC characters, all character animations, dungeon/town props |
| `Kenney/` | Fantasy Town Kit, Nature Kit ×2 (rocks, trees, cliffs, plants), Castle Kit, Graveyard Kit | Scenery, terrain dressing, buildings |
| `Quaternius/` | Farm Animal Pack (cow!), Ultimate Monsters Bundle, Ultimate RPG Items (weapons, armour, potions, loot), Ultimate Nature, Medieval Village MegaKit, Universal Base Characters + Modular Fantasy Outfits, Universal Animation Library ×2 | Monsters (Phase 2 cow), items/weapons/armour props, alternative characters/animations |

Tooling: `world/scripts/inspect-glb.mjs <files…>` prints bounds/rig/clips/textures of any GLB; `world/scripts/build-hero.mjs` rebuilds `hero.glb` from the library (Quaternius Male Ranger + retargeted UAL clips renamed to the protocol's `idle`/`walk`/`mine`/`attack`/`die`, textures shrunk to 1K webp). Both vendors' animation packs share joint names across all same-rig characters (Quaternius universal rig ↔ UAL1/UAL2; KayKit Rig_Medium ↔ Character Animations) — retarget by node name, the same way `build-hero.mjs` does, for any future character.

---

## 3) Architecture on one page

```
┌────────────────────────────┐        ┌─────────────────────────────────────┐
│ pocketrpg (existing Pages) │        │ pocketrpg-world (new Worker)        │
│  pocketrpg.co.uk           │        │  world.pocketrpg.co.uk              │
│                            │        │                                     │
│  Settings screen ──────────┼──────► │  GET /            → client assets   │
│   POST /api/world-token    │ #hand  │  POST /api/world/session (handoff)  │
│   (new Pages Function,     │  off   │  GET  /parties/zone/pasture  ─ WS ─►│
│    60s handoff JWT)        │        │   ┌──────────────────────────────┐  │
│                            │        │   │ WorldZone (Durable Object,   │  │
│  save blob in D1 ◄─────────┼────────┼───│  partyserver Server class)   │  │
│   (grant flush writes      │        │   │  in-memory: players, npcs,   │  │
│    XP→stats, items→bank    │        │   │  rocks, loot, 600ms interval │  │
│    via _lib/game/save.js)  │        │   └──────────────────────────────┘  │
└────────────────────────────┘        │  bindings: DB (same D1), JWT_SECRET │
                                      └─────────────────────────────────────┘
Shared by relative import from world/: src/engine/*, src/data/*.json,
functions/_lib/jwt.js, functions/_lib/game/{save,inventory,audit}.js
```

Key verified facts (re-verify in step 0.0, they are the guide's ground truth):
- `functions/_lib/jwt.js` exports `signJWT(payload, secret, expiresInSeconds)` and `verifyJWT(token, secret)` (HS256, Web Crypto, no deps).
- `functions/_lib/game/save.js` exports `loadCharacterWithSave(env, characterId, identityId)` and `writeSave(env, characterId, saveObject, expectedRevision)` (optimistic concurrency).
- `functions/_lib/game/inventory.js` exports `addItemToBank`, `addItemToInventory`, `getInventory`, `bankQuantity`, ….
- Save blob shape: `save.stats[skillId] = { xp, level }` (see `functions/_lib/saveSummary.js`); bank/inventory mutated only via the inventory helpers.
- `src/engine/combat.js` exports `createCombatState(monster, combatType, stance, spell)` and `processCombatTick(combatState, playerStats, equipment, itemsData, prayersData, inventory, slayerTask)`.
- `src/data/skills.json → mining.actions[]`: `{ id:'tin', level:1, ticks:4, xp:17, product:'tin_ore' }`, same for `copper`.
- `src/data/monsters.json → pasture_bull` as described in §1.

---

## 4) Repo layout to create (Phase 0, exact)

```
world/
├─ package.json          # self-contained package: NOT an npm workspace of root
├─ tsconfig.json
├─ wrangler.jsonc
├─ .dev.vars.example     # documents JWT_SECRET for local dev (real .dev.vars is gitignored)
├─ shared/
│  ├─ protocol.ts        # every WS message type (single source of truth, §5)
│  └─ zone.ts            # zone JSON types + loader/validator
├─ zones/
│  └─ pasture.json       # the one zone (§6.5)
├─ server/
│  ├─ index.ts           # Worker entry: routes /api/world/*, /parties/* → partyserver, else assets
│  ├─ session.ts         # POST /api/world/session handler
│  ├─ WorldZone.ts       # the Durable Object (partyserver Server subclass)
│  ├─ tick.ts            # pure per-tick simulation functions (unit-testable, no I/O)
│  ├─ pathfind.ts        # grid BFS (pure, unit-testable)
│  └─ grants.ts          # flushGrants(): the ONLY code that touches the save blob
├─ client/
│  ├─ index.html
│  ├─ vite.config.ts     # outDir dist, server.fs.allow ['../..'] for ../src imports
│  ├─ public/models/     # hero.glb (built by scripts/build-hero.mjs), rock.glb, chest.glb — all from assets/open-world (§2.1)
│  └─ src/
│     ├─ main.ts         # boot: auth → connect → scene
│     ├─ auth.ts         # handoff exchange, token storage, block-page gate
│     ├─ net.ts          # partysocket wrapper, typed send/receive from shared/protocol.ts
│     ├─ scene.ts        # three.js scene, camera, ground, lights
│     ├─ entities.ts     # player/npc/loot mesh management + tick interpolation
│     ├─ input.ts        # raycasting, left/right click, long-press, context menu
│     └─ ui.ts           # DOM panels: inventory, xp drops, hover text, messages
└─ tests/                # vitest for pathfind, tick logic, protocol guards, grants
```

Root-repo touches (only these, each named in a step): `functions/api/world-token.js`, one new migration in `migrations/`, the Settings-screen button, `docs/world-progress.md`, and `tests/` additions if a step says so. Add `world/node_modules`, `world/client/dist`, `world/.dev.vars` to root `.gitignore`.

Add to root `package.json` scripts (allowed): `"world:check": "cd world && npm run typecheck && npm test && npm run build"`.

**Commit gates.** Changes under `world/` only → run `npm run world:check`. Any change touching `src/**` or `functions/**` or `migrations/**` → ALSO run the full CLAUDE.md §11 gate (`npm test && npm run build && npm run rebuild && npm run check:single`).

---

## 5) Wire protocol (DECIDED — implement exactly, all in `world/shared/protocol.ts`)

JSON text frames over one WebSocket. Every message has `t`. Unknown `t` from client → close connection code 1008. Client messages are rate-limited server-side: >10 messages/sec → close 1008.

**Client → server**
```ts
{ t:'hello', token:string }                       // MUST be first frame; world-session JWT
{ t:'walk', x:number, z:number }                  // tile coords, integers
{ t:'interact', kind:'rock'|'npc'|'loot'|'object', id:string, action:string }
                                                  // actions: rock:'mine' object:'deposit' npc:'attack' loot:'take'
{ t:'cancel' }                                    // stop current path/action
{ t:'ping', n:number }
```

**Server → client**
```ts
{ t:'welcome', selfId:string, tick:number,
  zone:{ id:string, w:number, h:number, collision:string[] },   // collision: h strings of w chars, '#'=blocked '.'=walkable
  statics:[{ id, type:'rock'|'bank_chest', rock?:string, x, z }],
  you:{ x, z, stats:Record<string,{xp:number,level:number}>, inventory:InvSlot[] } }
{ t:'diff', tick:number,
  ents?: [{ id, kind:'player'|'npc', x, z, anim:'idle'|'walk'|'mine'|'attack'|'die', hp?:number, maxHp?:number, monsterId?:string, name?:string }],
  removed?: string[],
  rocks?: [{ id, depleted:boolean }],
  loot?:  [{ id, itemId:string, qty:number, x, z }],       // full loot list visible to THIS client (owner filtering server-side)
  lootRemoved?: string[],
  events?: [ { e:'hit', targetId:string, dmg:number }      // 0 dmg = block splat
           | { e:'xp', skill:string, amount:number }
           | { e:'msg', text:string }                      // "Your pack is full." etc.
           | { e:'inv', inventory:InvSlot[] } ],           // full session-inventory replace
  }
{ t:'dead', respawn:{x:number,z:number} }
{ t:'error', code:string, msg:string }
{ t:'pong', n:number }
```
`InvSlot = { itemId:string, quantity:number } | null` — array length always 28.

Rules: exactly **one `diff` broadcast per tick per client**, containing only what changed for that client (position moves, anim changes, rock state, loot add/remove, events). No diffs are sent for ticks where nothing changed and nobody moved. `events` are per-recipient (your XP drops go only to you; hitsplats go to everyone in the zone).

---

## 6) PHASE 0 — Auth handoff, deployable, movement (no gameplay)

**Definition of done**: developer clicks "Enter World (beta)" in PocketRPG on desktop, lands on `world.pocketrpg.co.uk`, sees their character name, and walks the hero model around the pasture zone by clicking; movement is server-authoritative and survives a reconnect at the same position; a second browser tab does NOT show the other player (rendering others is Phase 2+; the server may track them, the client renders only self in Phase 0).

### STEP 0.0 — Ground-truth preflight (no code)
Read, in full: `functions/_lib/jwt.js`, `functions/_lib/auth.js`, `functions/_lib/game/save.js`, `functions/_lib/game/inventory.js`, `functions/api/save.js` (GET+PUT), `functions/api/actions/_completeShared.js`, `src/data/skills.json` (mining), `src/data/monsters.json` (pasture_bull), root `wrangler.toml`, `build_single.cjs` top comments, and the `partyserver` README (https://github.com/threepointone/partyserver — packages/partyserver and packages/partysocket). Confirm every "verified fact" in §3. Record confirmations (or discrepancies → DEVELOPER TASK) in `docs/world-progress.md`. Also run `ls migrations/ | sort | tail -3` and note the next migration number `NNNN`.

### STEP 0.1 — Scaffold `world/`
Create the §4 skeleton with placeholder implementations that compile. `world/package.json` deps (pin exact versions; check `public/vendor/three/` version by reading its build banner or `package.json` at root if three is listed — else pin the latest r1xx and note it): `three`, `partyserver`, `partysocket`; dev: `typescript`, `vite`, `wrangler`, `vitest`, `@types/node`, `@cloudflare/workers-types`. Scripts: `dev:client` (vite), `dev` (wrangler dev), `build` (vite build), `typecheck` (tsc --noEmit), `test` (vitest run).
`world/wrangler.jsonc` (adjust key names to current wrangler schema if it complains — schema drift is an allowed deviation, record it):
```jsonc
{
  "name": "pocketrpg-world",
  "main": "server/index.ts",
  "compatibility_date": "2026-07-01",
  "assets": { "directory": "client/dist", "binding": "ASSETS" },
  "durable_objects": { "bindings": [{ "name": "WorldZone", "class_name": "WorldZone" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["WorldZone"] }],
  "d1_databases": [{ "binding": "DB", "database_name": "pocketrpg", "database_id": "439e810b-8dce-4697-94c2-a7392520ad8f" }]
}
```
Acceptance: `npm run world:check` passes (tests may be a single placeholder), `cd world && npx wrangler dev` starts and serves a "world placeholder" index page locally.

### STEP 0.2 — Migration for world tables
New file `migrations/NNNN_world.sql` (NNNN from step 0.0):
```sql
CREATE TABLE world_positions (
  character_id INTEGER PRIMARY KEY,
  zone_id TEXT NOT NULL,
  x INTEGER NOT NULL,
  z INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE world_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_world_grants_char ON world_grants (character_id, created_at);
```
Run the root commit gate (migrations/ touched). DEVELOPER TASK: apply to local AND production D1 when deploying (`npx wrangler d1 migrations apply pocketrpg` / `--remote`), per this repo's usual migration flow.

### STEP 0.3 — Auth handoff endpoints
**(a)** `functions/api/world-token.js` — copy the auth + character-ownership pattern from `functions/api/save.js` (`requireAuth`, `getCharacterId`-style ownership SELECT). On `POST`: return `json({ handoff: await signJWT({ sub: auth.identity.id, character_id: ch.id, scope: 'world_handoff' }, env.JWT_SECRET, 60) })`. No D1 writes. Add a vitest under `tests/` mirroring how existing function tests are structured (find one with `grep -rl "onRequestPost" tests/` and mimic; if none test functions directly, unit-test only the payload shape via `signJWT`/`verifyJWT` round-trip and note it).
**(b)** `world/server/session.ts` — `POST /api/world/session`, body `{ handoff }`: `verifyJWT(handoff, env.JWT_SECRET)`; require `scope === 'world_handoff'`; then SELECT the character row from D1 (id + name, ensure not deleted, owner matches `sub`); reply `{ token: await signJWT({ sub, character_id, scope:'world' }, env.JWT_SECRET, 86400), character: { id, name } }`. Wrong/expired/mis-scoped token → 401 `{ error }`. The 30-day default expiry of `signJWT` must NOT be used — pass explicit expiries (60, 86400).
Root gate (functions/ touched) + `world:check`.

### STEP 0.4 — Client boot, auth, platform gate
`client/src/auth.ts`: on load, if `location.hash` matches `#handoff=<jwt>` → strip it from the URL via `history.replaceState`, POST to `/api/world/session`, store `{token, character}` in `localStorage['world_session']`. Else use stored session. No/invalid session → full-page message with a link to `https://pocketrpg.co.uk`. Viewport gate: if `Math.min(screen.width, innerWidth) < 768` → full-page "PocketRPG World needs a desktop or tablet." block; re-check on resize. No 3D yet: after auth, render "Welcome, <name>" in DOM.
Acceptance: unit tests for hash parsing + gate logic; manual local run with a token minted by the dev-seed script (step 0.5).

### STEP 0.5 — Local dev seed + `.dev.vars`
`world/.dev.vars.example` containing `JWT_SECRET=dev-secret-change-me`. `world/scripts/dev-seed.mjs`: creates the local D1 tables it needs (`identities`? — **read the earliest migrations to learn exact table names/columns for identities, characters, saves**; use the real schema, inserting one identity + one character + one minimal gzipped save blob via `functions/_lib/saveCodec.js` helpers if usable from Node, else store whatever format `loadCharacterWithSave` reads — verify by reading `functions/_lib/game/save.js` + `saveCodec.js`) and prints a ready `#handoff=` URL signed with the dev secret. Wire: `npm run dev:seed`. This script is dev-only; it must refuse to run if `CLOUDFLARE_ENV`/`CF_PAGES` env suggests production.
Acceptance: `wrangler dev` + seeded URL → step 0.4 welcome screen shows the seeded character's name.

### STEP 0.6 — Zone format + pasture.json
`world/shared/zone.ts` types + `validateZone()` (dimensions match collision strings, spawn walkable, objects/npcs on walkable tiles, ids unique). `world/zones/pasture.json`, 32×32: grassy open field, a fenced pasture area (fences are `#` tiles) with a gate gap, 3 tin rocks + 2 copper rocks clustered near the north-west corner, 1 `bank_chest` near spawn, spawn at (16,16). Author it by hand as ASCII; keep ≥70% walkable. NPC list: empty for now (cow added in Phase 2 — but include the `npcs` field as `[]`).
```jsonc
{ "id":"pasture", "name":"Verdant Pasture", "width":32, "height":32,
  "spawn":{"x":16,"z":16},
  "collision":[ "32 strings of 32 chars, '#' or '.'" ],
  "objects":[ {"id":"rock_tin_1","type":"rock","rock":"tin","x":4,"z":5}, {"id":"chest_1","type":"bank_chest","x":14,"z":15} ],
  "npcs":[] }
```
Vitest: zone validates; a deliberately broken fixture fails.

### STEP 0.7 — Pathfinding (pure)
`world/server/pathfind.ts`: `findPath(collision, from, to, maxLen=64): {x,z}[] | null`. BFS over 8 neighbours; a diagonal step is legal only if **both** adjacent cardinal tiles are walkable (no corner cutting). If target blocked, path to the nearest walkable tile adjacent to it (for interactions) or return null for plain walks. Exhaustive vitest: straight line, around wall, corner-cut refusal, unreachable, maxLen truncation.

### STEP 0.8 — WorldZone DO + movement tick
`world/server/WorldZone.ts` extends partyserver's `Server`. Follow the partyserver README exactly for: export from `server/index.ts`, `routePartykitRequest`-style routing of `/parties/...`, and hibernation options — **set hibernation OFF for now** (the zone ticks while occupied; empty zones have no connections). Connection lifecycle:
- On WS connect: mark connection "unauthed"; first frame must be `hello` within 5 s → `verifyJWT(token)`; require `scope==='world'`; reject → close 1008. On auth: load position from `world_positions` (fall back to zone spawn), add to in-memory `players` map keyed by `character_id` (a second connection for the same character closes the first), send `welcome`, ensure the tick interval is running.
- In-memory player: `{ charId, name, conn, x, z, path:{x,z}[], anim, queued:Intent|null, lastMsgTimes:number[] }`.
- `onMessage`: validate against §5; `walk` → compute path from current tile, store (replaces existing), clear queued intent; `cancel` → clear both; `ping` → `pong` immediately (not tick-gated).
- Tick (`setInterval(…, 600)` started when first player joins, `clearInterval` when last leaves): advance every player 1 step along `path`; collect changes; build per-client `diff` with ONE `send` per client; skip send when that client's view changed nothing.
- Checkpoints (the ONLY durable writes in this phase): on disconnect and every 100 ticks (60 s), write each dirty player's `world_positions` row (single `INSERT … ON CONFLICT(character_id) DO UPDATE`). Batch with `env.DB.batch`.
`world/server/tick.ts` holds the pure "advance movement / build diff" functions; vitest them (players move 1 tile/tick, diffs minimal, disconnect persists position — mock the DB).

### STEP 0.9 — three.js scene, click-to-move, placeholder avatar
`scene.ts`: renderer (`antialias:true`, `setPixelRatio(min(devicePixelRatio,2))`), hemisphere + directional light, ground: one `PlaneGeometry(w,h)` with a repeating grass-green checker `CanvasTexture` (two greens, e.g. #4a7c3a/#568c44) — blocked tiles get darker overlay quads. Camera DECIDED: `PerspectiveCamera(fov 40)`, position = player + `(0, 12, 9) * zoom`, `lookAt(player)`, `zoom` clamped 0.6–1.8 via wheel / two-finger pinch. No rotation in v1.
`entities.ts`: self = a capsule (`CapsuleGeometry`) placeholder; store `prev`/`next` tile positions and interpolate `prev→next` over 600 ms each diff (`performance.now()`-based lerp).
`input.ts`: `pointerdown` → `Raycaster` against ground plane → tile coords → send `walk`. Show a small click marker (fading yellow ring mesh) at the target.
Acceptance: local run — click moves the capsule smoothly tile-to-tile; refresh reconnects at the same tile (checkpoint write on disconnect).

### STEP 0.10 — Hero model + animations
**Superseded (2026-07, developer decision)**: the main game's `public/3d-samples/hero.glb` is no longer used in the world client. The hero is the Quaternius **Male Ranger** (Modular Fantasy outfit pre-fitted on the Universal Base Character body, 65-joint universal rig — chosen over KayKit so Quaternius outfits/items layer onto it later) built by `world/scripts/build-hero.mjs` from the §2.1 library — UAL1/UAL2 clips (`Idle_Loop`, `Walk_Loop`, `TreeChopping_Loop`, `Sword_Attack`, `Death01`) retargeted by joint name and renamed to the protocol anims (`idle`, `walk`, `mine`, `attack`, `die`); 4K PBR maps stripped to 1K webp base color (66 MiB → 1.9 MiB — when editing the script, dispose unwanted clips' channels+samplers before `mergeDocuments` or every clip's data comes along). Client (`entities.ts`) queues one waypoint per diff (catch-up at 440 ms/segment when behind, snap when ≥4 queued), rotates the model toward its walk direction, and derives walk/idle from actual traversal (server anims drive `mine`/`attack`/`die`). Crossfade 150 ms. `world/scripts/list-anims.mjs` prints the built hero's clips.
Acceptance: hero idles when still, walks when moving, faces its direction, no T-pose flashes.

### STEP 0.11 — PocketRPG entry button
In the Settings screen component (locate via `grep -ril "settings" src/screens/`), add a "Enter World (beta)" button rendered only when `localStorage.pocketWorldBeta === '1'`: onClick → `POST /api/world-token` (reuse the client API helper pattern in `src/cloud/api.js`), then `window.open('https://world.pocketrpg.co.uk/#handoff=' + res.handoff)`. Make the world origin a constant that falls back to the workers.dev URL until DNS exists (read it from a new export in the same file, developer fills the value in DT below). Follow CLAUDE.md §9/§12 (44px target, screen already in chunk — verify which bundle the Settings screen is in before editing). **Full root commit gate.**

### STEP 0.12 — Phase 0 deploy + acceptance
DEVELOPER TASK (single block): 1) `cd world && npm i && npm run build && npx wrangler deploy`; 2) `npx wrangler secret put JWT_SECRET` (same value as Pages); 3) apply migration `--remote`; 4) paste the workers.dev URL back (agent commits it into the 0.11 constant); 5) optionally add the custom domain; 6) run the manual script: log into PocketRPG → set `localStorage.pocketWorldBeta='1'` → Settings → Enter World → verify name, click-walking, reconnect position, block page on a phone-width window, and that a wrong/expired handoff shows the login-required page. Developer replies "PHASE 0 ACCEPTED" (or issues) before Phase 1 begins.

---

## 7) PHASE 1 — Mining, session inventory, grant flush into PocketRPG

**Definition of done**: developer's carried PocketRPG inventory appears in the world's 28-slot panel at login (same items/icons); they mine 5 tin (pick animation, XP drops, ore joining the pack), deposit at the chest, open PocketRPG, and see Mining XP +85 and everything deposited in the bank. Disconnecting mid-session with undeposited ore lands that ore in the PocketRPG **inventory** (e.g. carried 5 tin in + mined 5 more = 10 in the inventory), never silently in the bank.

### STEP 1.1 — Rocks in zone + statics protocol
Server: load zone objects into DO memory `{ id, rock:'tin'|'copper', x, z, depletedUntilTick:0 }`. `welcome.statics` includes them; `diff.rocks` broadcasts depleted/respawned transitions. Client: render rocks with the §2.1 library boulder (`world/client/public/models/rock.glb`, Kenney nature kit) tinted per ore (copper #b87333, tin #9aa5ad); depleted → smaller scale + darkened. `IcosahedronGeometry` grey boulder stays as the load-failure fallback.

### STEP 1.2 — Mining loop (server, PocketRPG semantics — DECIDED)
`interact {kind:'rock', action:'mine'}`: path the player to the nearest tile adjacent (8-dir) to the rock; on arrival start mining. Look up the action in `src/data/skills.json → mining.actions` by rock id: require `level ≤` player's Mining level (from session stats; on refusal send `events:[{e:'msg', text:'You need Mining level N to mine this rock.'}]`). While mining: `anim:'mine'`; every `action.ticks` ticks, if the rock is not depleted: +1 product to session inventory, +`action.xp` Mining XP to the session tally, emit `{e:'xp'}` + `{e:'inv'}`, deplete the rock for **8 ticks**, and stop (one ore per interaction, OSRS-style: the player re-clicks or — DECIDED — auto-continues on the same rock when it respawns if the player hasn't moved/acted; implement auto-continue). Moving/other intents cancel mining. Session inventory full → `{e:'msg', text:'Your pack is full.'}` and stop.
Session stats: seeded at `hello` time by reading the save blob once — add `loadCharacterWithSave` call in the DO's auth step; derive `{xp, level}` per skill from `save.stats` (level via `getLevelFromXP` from `src/engine/experience.js` when the stored level is missing). XP earned in-world updates session stats immediately (so level-ups apply in-session; send `{e:'msg', text:"Congratulations, you've reached Mining level N!"}`).
All of this lives in pure functions in `tick.ts` + a new `world/server/mining.ts`; vitest: full mine cycle, depletion, level gate, pack-full, auto-continue.

### STEP 1.3 — Session inventory UI
`ui.ts`: fixed right-side panel, 4×7 grid of 40px cells (28 slots), rendered from the last `{e:'inv'}`; item icon = the `icon` emoji from `src/data/items.json` (import the JSON in the client) + quantity badge for stacks. XP drops: floating `+17 Mining` text rising from the avatar (DOM overlay, 1.2 s fade). Message events → a 3-line message strip bottom-left.

### STEP 1.4 — Grant flush (`world/server/grants.ts`) — the only save-blob writer
`flushGrants(env, who, payload)`, called on: bank-chest `deposit` interact (banks the whole pack: save-backed units move inventory→bank, world-minted units grant to bank; empties session inventory), disconnect (world-minted units grant to the save **inventory**, overflow to bank; XP), and a 100-tick timer (XP only — items stay in the session pack until deposit/disconnect). The session pack seeds from the save inventory at hello (`sessionInventoryFromSave`), with save-backed vs minted unit counts tracked separately so seeded items are never re-granted.
Algorithm (DECIDED):
1. Build payload `{ xpBySkill, items:[{itemId,quantity}], reason }`; skip if empty.
2. `idempotency_key = "wg:" + charId + ":" + sessionId + ":" + flushSeq++` (`sessionId` = crypto.randomUUID() minted at hello). `INSERT INTO world_grants … ON CONFLICT DO NOTHING`; if no row inserted → already applied → return.
3. Up to 3 attempts: `loadCharacterWithSave` → for each skill: `save.stats[skill].xp += amount` (clamp to the 200M cap from `src/engine/experience.js`), `save.stats[skill].level = getLevelFromXP(xp)`; for each item: `addItemToBank(save, itemId, qty)` → `writeSave(env, charId, save, expectedRevision)`. On revision-conflict error re-read and retry; after 3 failures, log, delete the idempotency row, and re-queue the payload in memory for the next flush.
4. ~~Mirror `/api/save` PUT's denormalized-summary update~~ — verified 2026-07: `writeSave` itself already refreshes total_level/combat_level on every call; no extra code needed.
5. `auditLog(env, …)` — match the exact signature/usage in `functions/_lib/game/audit.js` with event type `world_grant` and the payload.
Vitest with a mocked env/DB covering: idempotent replay, revision-conflict retry, XP cap clamp, pack contents → bank.
**Do not** add any save-blob validation/policing here (CLAUDE.md §14 — grants are additive server-side writes, the trusted-blob model is unchanged).

### STEP 1.5 — Bank chest interact + Phase 1 acceptance
Chest default action `Deposit` (left-click) → path adjacent → flush(reason 'deposit') → `{e:'inv'}` empty + `{e:'msg','You deposit your items into your bank.'}`. Chest mesh: §2.1 library chest (`world/client/public/models/chest.glb`, KayKit dungeon), brown-box fallback.
DEVELOPER TASK — manual script: fresh session → mine tin ×5 (watch xp drops, inventory fills) → deposit → PocketRPG shows +85 Mining XP and +5 Tin Ore in bank; mine 2 copper, close the tab without depositing → PocketRPG shows the copper too (disconnect flush); confirm an idle-game save afterwards doesn't roll any of it back (play a few idle minutes, reload). Reply "PHASE 1 ACCEPTED".

---

## 8) PHASE 2 — Cow combat, floor loot, OSRS click model

**Definition of done**: developer left-clicks the Pasture Bull, walks over, fights it with hitsplats and an overhead HP bar, it dies and sinks/fades, loot appears on the floor at the death tile, right-click on the pile lists each item as `Take <Item Name>`, taking Bones/Raw Beef/Cowhide fills the pack, deposit lands them in the PocketRPG bank, Attack/Strength/Defence/HP XP appear per §5 rules, and the cow respawns. Right-click menus work everywhere (rock, chest, cow, loot, ground) on desktop; long-press does the same on a tablet.

### STEP 2.1 — Context menu + hover text (input layer, DECIDED spec)
Already built during Phase 1 (extend, don't rebuild): left-click default actions work via `input.ts` raycasting the `statics.ts` pickables list before the ground — each pickable wrapper carries `userData.pick = { kind, id, action }` and `pickTargetOf()` walks hits up to it. Add npcs/loot to that same pickables pattern. Still missing from this step: hover text, right-click/long-press context menu, pick-priority ordering, Examine.
Implement in `input.ts`/`ui.ts` before any combat:
- Maintain a hover pick every pointermove (throttled to animation frames): topmost entity under cursor with priority `loot > npc > rock/object > ground`. Top-left hover line, OSRS-style: `<default action> <Name>` in pale yellow, e.g. `Mine Tin Rock`, `Attack Pasture Bull (level-8)`, `Walk here`.
- Left-click: perform the default action of the picked thing — loot: `Take` top item; npc: `Attack`; rock: `Mine`; bank_chest: `Deposit`; ground: `Walk here`.
- Right-click / long-press ≥500 ms: DOM context menu at the pointer: header `Choose Option`; one row per action for **every** pickable thing under the cursor (ray hits sorted near-to-far), then `Walk here`, then `Cancel`. Rows: white text, target name in cyan for npcs/objects, `(level-8)` in green when player's combat level ≥ monster's else red (combat level via `src/engine/combatLevel.js`). Click outside or `Cancel` closes. Menu rows are min 32 px tall (tablet-friendly).
- `Examine` row for npc/rock/loot (last before Walk here) → `{e:'msg'}`-style local text; examine strings live in a small map in `ui.ts` (write original flavour text, e.g. bull: "A hefty highland bull. Prime cowhide on the hoof.").
Vitest the pick-priority and menu-composition logic (pure functions, mock ray hits).

### STEP 2.2 — Cow NPC: spawn + wander
Add to `pasture.json` `npcs`: `{ "id":"bull_1", "monsterId":"pasture_bull", "x":22, "z":20, "wander":{"x":18,"z":16,"w":10,"h":10} }`. Server: NPC in-memory `{ id, monsterId, x, z, hp, maxHp, state:'idle'|'combat'|'dead', respawnAtTick }`; when idle, every 5–13 ticks (random) step 1 walkable tile staying inside the wander rect. Broadcast via `diff.ents` (kind 'npc', include `monsterId`, hp/maxHp only while in combat). Client renders it as a brown box 1.4×0.9×0.9 placeholder with the name from `monsters.json`.
Cow model: process one from the §2.1 library (Quaternius Farm Animal Pack has a rigged cow) into `world/client/public/models/cow.glb` — no DT needed; clips mapped like the hero (idle/walk/die; attack optional). **Built 2026-07** via `scripts/build-cow.mjs` (clip-rename only, own rig, no textures). Gotcha: the Farm pack authors the body length along the vertical axis (unlike the character packs) — `createCowMesh` rotates the model **−π/2 about X** to stand it up before centring/scaling; and `Box3.setFromObject` is unreliable for skinned meshes (ignores node rotation), so trust the render, not the bbox.

### STEP 2.3 — Combat via the real engine (server)
On `interact {kind:'npc', action:'attack'}`: path adjacent, then start combat — **build it as a thin adapter around `src/engine/combat.js`, written test-first**:
1. First commit: `world/tests/combat-adapter.test.ts` that, WITHOUT the DO, drives `createCombatState(monstersData.pasture_bull, 'melee', playerStanceDefault)` + repeated `processCombatTick(state, playerStats, equipment, itemsData, prayersData, inventory, null)` until the bull dies. **Read `processCombatTick` (src/engine/combat.js:409) end-to-end first** to learn its exact return/mutation contract (hits dealt/taken, xp awards, kill signal, monster hp field names) — encode that contract in the test's assertions, including §5 XP rules (4 XP/damage to the style skill, 1.33 XP/damage to HP). Stance DECIDED: fixed `'accurate'` in v1 (no stance UI).
2. Player inputs to the engine: `playerStats` and `equipment` from the save blob (loaded at hello). **Correction (built 2026-07)**: `playerStats` is NOT passed untransformed — the engine wants flat skill LEVELS plus `currentHP`/`maxHP`/`hitpoints`, so flatten `save.stats[skill] = {xp,level}` to `getLevelFromXP(xp)` exactly as `functions/_lib/mcp/bossFight.js` does. `equipment` does pass through (empty/missing = unarmed, handled by the engine); `inventory: []` and `prayersData: {}` (no eating/prayer in world v1); `slayerTask: null`.
   - **Wandering-target gotcha (built 2026-07)**: a bull moves between ticks, so the single path computed on the attack interact lands on an empty tile by the time the player arrives and combat never starts. The npc-attack intent must PERSIST and re-approach (a `pathAdjacent` closure on the tick context) until adjacent — the bull stops wandering once combat begins, so it converges.
3. Adapter (`world/server/combatSession.ts`): one combat session per player; each zone tick advances it; hits → `events {e:'hit'}` to all clients + hp in `diff.ents`; XP → session tally (same pipeline as mining — flush rules unchanged) + `{e:'xp'}`. Player moving/cancelling ends combat (bull returns to idle, hp persists until it leaves combat 17 ticks with no attacker → full heal). Bull fights back through the same `processCombatTick` flow — do not write your own monster-attack math; if the engine's state machine needs the player "in combat" to process retaliation, that's what the test in (1) establishes.
4. Player death (bull max hit is 1; only possible at 1 HP): on HP ≤ 0 send `{t:'dead'}`, respawn at zone spawn full HP, no item loss, combat ends. Session HP: track current HP in session (seeded from blob HP level, i.e. max HP; regen +1 per 100 ticks to mirror §4's +1/60 s).

### STEP 2.4 — Death, floor loot, pickup
On bull death: `state:'dead'`, anim 'die', removed from `ents` after 3 ticks, `respawnAtTick = now + 25`; roll drops from `monsters.json → pasture_bull.drops` (chance-gated rolls, `quantity` ranges as `[min,max]` — mirror how the idle engine rolls drops: find and reuse/extract the existing drop-roll helper from `src/engine/` via `grep -rn "drops" src/engine/loot* src/engine/*.js | head`; reuse it, don't re-roll your own). Each dropped item → loot entity at the death tile `{ id, itemId, qty, x, z, ownerCharId, spawnTick }`. Visibility filtering happens **server-side when building each client's diff**: owner-only until `spawnTick+100`, everyone until `spawnTick+300`, then `lootRemoved`. Multiple items on one tile are all listed in that tile's context menu (`Take Bones`, `Take Cowhide`, …); left-click takes the most recently dropped.
`interact {kind:'loot', action:'take'}`: path to the tile, verify still present + visible to this player, add to session pack (full → pack-full message), `lootRemoved` broadcast. **Inventory-first requirement (2026-07 semantics change)**: every Take MUST also increment `player.minted[itemId]` — an item in the session pack that is neither save-backed nor minted is invisible to every flush and silently evaporates on deposit/disconnect. Add a test asserting picked-up loot survives a disconnect flush into the save inventory. Client: loot rendered as a small spinning item marker per tile (flat plane with the item's emoji drawn to a CanvasTexture — one shared texture cache).
Vitest: drop rolling uses the shared helper, owner-window filtering, take-vs-despawn races, stack quantities.

### STEP 2.5 — Combat presentation
HP bar: DOM overlay div above the bull (project entity position → screen each frame), green/red ratio, visible while in combat and for 10 ticks after. Hitsplats: red square with white number (blue square for 0) at the target's screen position, 900 ms fade, both from `{e:'hit'}`. Player attack anim: already done — hero.glb ships an `attack` clip (UAL1 `Sword_Attack`) and the client animator plays whatever anim the server broadcasts (`die` too, LoopOnce+clamp); the server just has to set `anim:'attack'` during combat ticks. Bull hurt flash: material emissive pulse.

### STEP 2.6 — Phase 2 acceptance
Full root + world gates green, then DEVELOPER TASK — manual script: desktop: hover texts correct on ground/rock/chest/bull/loot; right-click menus everywhere per §8.1; kill the bull twice (hitsplats, hp bar, death anim, respawn ~15 s); loot appears at death tile, second account/browser cannot see it for 60 s but can after; take all three drops, deposit, verify PocketRPG bank + Attack/HP XP moved consistently with §5 math; tablet: tap-to-act + long-press menus. Reply "PHASE 2 ACCEPTED".

---

## 9) PHASE 3 — Other players, presence, local chat (added 2026-07 on developer instruction)

Master plan `docs/open-world-companion-game-plan.md` §7 "Phase 4 — Other players", scoped for v1: players in the same zone see each other move with name plates and can talk in local chat. Players are **ghosts** — no collision (pathfinding already ignores players), no trading, no interactions, no pick target. **Scope cut (DECIDED)**: every player renders as the shared `hero.glb`; equipment-driven appearance is deferred to a later phase.

**Definition of done**: two accounts in the pasture see each other walking/mining/fighting with the correct name plate, a player already in the zone is visible immediately on join, joins/leaves add/remove the other hero within a tick, chat lines appear in both the message log (`Name: text`) and as overhead text above the speaker, and none of Phase 0–2 regresses.

### STEP 3.0 — Carried-in bugfix: right-click must not walk
Phase 2 device feedback: on desktop a right-click both opened the menu AND walked (pointerup fired `performDefault` for every button). Gate the default action on `event.button === 0` in `input.ts`. Verify with the two-client e2e in 3.4 (right-click in browser A produces no ent diff for A at observer B).

### STEP 3.1 — Presence protocol (server)
The tick loop already broadcasts `kind:'player'` ents zone-wide when a player changes; what's missing is the edges:
- Welcome: after the intro diff's npcs/loot, include ents for every OTHER player currently in the zone (never self — the client owns self from `welcome.you`).
- Join: queue the new player's charId at hello; the next tick emits its `toEntityDiff` to everyone (one-tick latency is fine).
- Leave: on close/duplicate-connection kick, broadcast `removed: [charId]` (reuse the existing `removed` field — ids are disjoint from npc ids).
Keep `toEntityDiff` as-is (id/kind/x/z/anim/name — no hp: other players' HP is private).

### STEP 3.2 — Other players on the client
`main.ts`: a `others` map mirroring the npc pattern (async `createHeroMesh()` with pending-diff buffering, template already cached so N players = 1 GLB fetch). `ents` routing: self → self, `kind:'npc'` → npcs, other `kind:'player'` → others. `removed` must route to the right map. No `userData.pick` (ghosts — the ray passes through to loot/npcs/ground beneath). Name plate: DOM overlay per other player (same projection helper as HP bars), white name, small, `pointer-events:none`; self gets none (you know who you are).

### STEP 3.3 — Local chat
- Protocol: client `{t:'chat', text}`; server sanitises (trim, strip control chars, cap 120 chars, drop empty) — sanitiser is a pure function in `world/shared/chat.ts` with Vitest — then broadcasts zone event `{e:'chat', charId, name, text}` (existing rate limiter covers flooding).
- Client: an input row pinned under the message log (Enter sends, Escape blurs; clicking the canvas never focuses it). The global `user-select:none`/`touch-action:none` from the mobile fixes must be overridden ON THE INPUT (`user-select:text`) or typing/caret breaks on mobile. Render received chat as `Name: text` in the message log AND as overhead text above the speaker's head (or self) for ~4 s (DOM overlay, same projection).
- All chat rendering uses `textContent` (player-authored strings — no innerHTML, ever).

### STEP 3.4 — Phase 3 acceptance
Two-connection WS e2e (agent-runnable): B joins after A → A gets B's ent + B's intro lists A; A walks → B streams A's diffs; A chats → B receives `{e:'chat'}` with A's name; A right-clicks (browser) → B sees no movement; A disconnects → B gets `removed:[A]`. Needs a second seeded character in `world/scripts/dev-seed.mjs`. Playwright: two pages, screenshot shows both heroes + name plate + overhead chat. Full world gate green; root gate only if `src/**`/`functions/**` touched.
DEVELOPER TASK — manual script: two devices/browsers, both enter the pasture; verify you see each other walk/mine/fight, name plates correct, chat works both ways (log + overhead), right-click no longer walks on desktop, and a page close removes the other hero. Reply "PHASE 3 ACCEPTED".

---

## 10) PHASE 4 — Shared-kill loot attribution + pack reordering (added 2026-07-10 on developer decision)

Roadmap context: `docs/open-world-next-phases-scope.md` (Phases 4–8, decisions confirmed 2026-07-10); asset tracking: `docs/open-world-asset-coverage.md`. This phase is server-heavy with one client UI feature; no new assets, no new zones.

**Definition of done**: two players fight the same bull — its HP is genuinely shared (both see one bar drain), it retaliates against exactly one of them, and on death the drop's owner window belongs to whoever dealt the **most damage** (tie → first to reach that total). Reordering the pack by dragging works on desktop and touch, survives a mine/deposit round-trip, and slot order has no effect on flush semantics.

### STEP 4.1 — Damage attribution + shared monster HP (server)
`world/server/npc.ts`: `NpcState` gains `damageByChar: Map<string, { dmg: number; tick: number }>` (`tick` = when that total last increased, for the tie-break). Cleared on respawn AND on out-of-combat full heal. Export pure `topDamageContributor(npc): string | null` — max `dmg`, tie → smaller `tick`.
`world/server/combat.ts` (`stepCombat`):
- Before `processCombatTick`, sync the session's engine state from the shared record: `combat.state.monster.currentHP = npc.hp`. Players tick sequentially inside the zone tick, so damage serializes correctly; a same-tick second attacker on an already-dead npc is stopped by the existing `state === 'dead'` guard.
- On `playerHit` with damage > 0, accumulate into `damageByChar`.
- `killNpc`: loot `ownerCharId = topDamageContributor(npc) ?? killer.charId`.

### STEP 4.2 — Single retaliation target (server)
With N concurrent attackers, each player's engine session also processes monster attacks — untouched, the monster would swing N times per tick. Fix in the adapter, not the engine:
- `npc.attackerId` becomes the retaliation target: **claim-if-null** in `stepCombat` (replace the unconditional assignment). Monster-sourced events (`monsterHit`/`monsterMiss`/`dragonfireHit`) are applied ONLY by the session whose player is the current target; other sessions discard them (no HP change, no hitsplat).
- Release the target on: walk-away (exists), npc death (exists), disconnect (exists in `onClose`), and **player death** (missing today — clear it in the `player.hp <= 0` branch). A surviving attacker's session claims the vacancy next tick, so aggro hands over automatically.

### STEP 4.3 — Pack reordering (protocol + server + client)
- `world/shared/protocol.ts`: client message `{ t:'moveInv', from:number, to:number }`; parse requires integers in `[0,28)`, else invalid (close 1008). `from === to` parses fine and no-ops.
- Server: pure `moveInventorySlot(inventory, from, to)` in `world/server/mining.ts` (plain swap — dropping onto a filled slot swaps, onto an empty slot relocates; identical semantics to `src/components/InventoryGrid.jsx`). `WorldZone` queues the player for an `{e:'inv'}` event on the **next tick** (one diff per client per tick stays intact). Slot order is irrelevant to every flush (they read the `minted`/`saveBacked` tallies), so reorder needs no grant/deposit coupling — assert that in a test, don't "fix" it.
- Client: drag from any filled cell of `#inv-panel` (pointer events, ~6 px threshold before it counts as a drag, ghost clone follows the pointer, target cell highlights). On drop over a different slot: swap the local copy immediately (optimistic), re-render, send `moveInv`; the server's next-tick `{e:'inv'}` is the authoritative echo. Touch works through the same pointer path (the global `touch-action:none` already prevents scroll interference).

### STEP 4.4 — Tests + acceptance
Vitest (extend `combat-adapter.test.ts` / `tick.test.ts` / `mining.test.ts`): two attackers drain one shared HP pool; only the target takes monster hits; aggro hands over when the target dies/leaves; top-damage owns the drop; equal damage → earlier contributor owns it; `damageByChar` resets on respawn and full heal; `moveInventorySlot` swap/relocate/bounds; reordered pack flushes identically.
Agent e2e (two WS clients against `wrangler dev`): both attack the bull, assert one shared HP trajectory in both clients' diffs, exactly one target receiving hitsplats, and the loot visible only to the top-damage client during the owner window. `moveInv` round-trip: swap two slots, assert next tick's `{e:'inv'}`.
DEVELOPER TASK — manual script (DT-P4): two devices on the pasture; fight the same bull from both; verify one HP bar, sensible hitsplats, top-damage player sees the drop first; drag-reorder the pack on desktop and phone; mine → deposit → PocketRPG bank unchanged by reordering. Reply "PHASE 4 ACCEPTED".

## 11) PHASE 5 — Equipment visuals v1: weapons in hand (added 2026-07-10 on developer instruction)

Decision D3 (docs/open-world-next-phases-scope.md): archetype × tier tint, maximum asset reuse; per-archetype coverage tracked in `docs/open-world-asset-coverage.md`.

**Definition of done**: a character's PocketRPG-equipped weapon appears in their hero's right hand (correct archetype silhouette, tier tint), other players see it too, unmapped/absent weapons render bare-handed, and none of Phases 0–4 regresses.

### STEP 5.1 — Archetype models
`world/scripts/build-weapons.mjs` → `world/client/public/models/weapons/<archetype>.glb` for `sword, sword2h, dagger, axe, axe2h, blunt, bow, crossbow, staff, wand` (KayKit Adventurers glTFs — grips authored at the origin, blade +Y; `blunt` from the Quaternius Hammer_Double OBJ via `obj2gltf`, installed `--no-save` when regenerating). 22–101 KiB each.

### STEP 5.2 — Mapping registry (shared)
`world/shared/appearance.ts`: `gearFromEquipment(save.equipment)` → `GearDescriptor` (`{ weapon?: { archetype, tint? } }`). Pattern rules ordered specific-before-generic (crossbow>bow, battleaxe>axe, godsword>sword); `twoHanded` upgrades sword/axe to the 2h model; tier prefixes map to tint hexes; unmapped → `{}` (bare hands, never blocks). Exotics ride nearest silhouettes (whip/claws/tentacle→dagger, spear/lance/harpoon→staff pole) until bespoke models exist.

### STEP 5.3 — Protocol + server
`GearDescriptor` on `EntityDiff.gear` and `welcome.you.gear` (server→client only). Computed once at hello (`Player.gear`), fixed for the session (no world equip UI; a reconnect re-reads the save). `toEntityDiff` carries it whenever a weapon is mapped.

### STEP 5.4 — Client rendering
`entities.ts` `applyWeapon(heroMesh, gear)`: cached GLB template → clone → tint (material color) → grip transform → attach under the rig's `hand_r` joint (idempotent per archetype+tint key, race-guarded across awaits, silent bare-hands fallback). Grip transforms: default `[-π/2, 0, π/2]` (blade upright in the palm); staff/wand flipped vertical (planted-pole look); bow/crossbow have provisional overrides pending visual tuning when a seeded character equips one. Hooked at self-create (welcome gear), other-create, and other-diff (no-op unless the key changes).

### STEP 5.5 — Acceptance
Agent-verified: appearance unit tests (pattern-order traps pinned); two-client WS e2e (each client's welcome carries own gear; each sees the other's archetype+tint in ent diffs); headless screenshots of the tinted sword and planted staff in-game. DEVELOPER TASK — manual script (DT-P5): equip different weapons in PocketRPG (a tiered melee weapon, a bow, a staff; then unequip), enter the world after each, verify the hand model + tint changes and other players see it; confirm bare hands for no weapon/fishing rod; eyeball bow/crossbow grips and report if they need tuning. Reply "PHASE 5 ACCEPTED".

## 12) PHASE 5.5 — Item interactions & banking (added 2026-07-10 on developer instruction)

Three developer requests in one phase: natural pathing, a real bank UI, and main-game item actions on the pack.

- **Pathing**: `world/server/pathfind.ts` is A\*, not BFS. Step count stays the primary cost (1 tick per step, diagonal or cardinal) but diagonals carry a tiny secondary cost (`DIAG_EPS`), so among equal-step routes the straightest wins and paths stay inside the start→destination rectangle. BFS's equal-step arcs (10 tiles off a straight line) are pinned by regression tests in `pathfind.test.ts`.
- **Pack actions** (`{t:'invAction', slot, action}`): left-click/tap fires the item's primary verb; long-press/right-click menu = primary verb + Drop. The verb derivation is shared client/server in `world/shared/itemActions.ts` (items.json slot → Wield/Wear, food → Eat, potion → Drink, skills.json `bury_*` → Bury) and the server re-derives + validates, so the client can't invent actions. Eat heals `item.heals` (HP pill + `{e:'hp'}` event, sent only on change). Bury grants the skills.json prayer XP. Equip runs the REAL engine (`checkEquipRequirements`/`equipItem`/`placeUnequippedItems` from `src/engine/equipment.js`), updates `player.gear` and re-announces the ent — `toEntityDiff` now always includes `gear` (even empty) so unequips propagate. Drink is deferred (message only; combat stat boosts need decay infra). Drop spawns floor loot at the player's tile with a **17-tick (~10s) owner window** (`PLAYER_DROP_OWNER_TICKS`), then it's public to everyone until the normal 300-tick despawn.
- **Banking** (`{t:'bank', op, itemId, qty}` + `{e:'bank', bank, open?}`): using a chest walks adjacent and opens the bank modal (`world/client/src/bank.ts`) — bank grid + pack grid, tap = move 1, long-press/right-click = Deposit/Withdraw 1/5/10/X/All (X prompts for an amount). The server clamps every quantity (held count, bank count, pack space) and requires chest adjacency per op; the modal closes on walk-away client-side. Charge-carrying bank entries are EXCLUDED from the world's bank view (charges can't be preserved through the session model). The old deposit-all chest action is gone.
- **Session accounting** (`world/server/sessionItems.ts`): every pack unit belongs to one pool — `minted` (world-created), `saveBacked` (seeded from save inventory), `bankSourced` (withdrawn). Consuming (eat/bury/drop/equip) drains minted→bankSourced→saveBacked, recording removals; deposits cancel bankSourced first, then bank minted, then move saveBacked. `GrantPayload` grew `removeFromInventory`/`removeFromBank`/`mintedToBank`/`bankToInventory`/`equipment` (snapshot when the player re-geared); all removals clamp to what the save still holds. Bank/equip/consume mutations schedule a debounced durability flush (5 ticks) on top of the 60s timer + disconnect flushes. Invariant (unit-tested): pack count per item === minted + saveBacked + bankSourced.

## 13) PHASE 6 — World expansion v1: zones, transitions, forest + Woodcutting (added 2026-07-11 on developer instruction)

Scope source: `docs/open-world-next-phases-scope.md` Phase 6 (decisions D2/D4/D5 apply: hybrid geography, Woodcutting first, all monsters passive). Testing is bundled — the DT-class B manual script at the end covers Phases 4, 5, 5.5 and 6 in one pass, per developer instruction 2026-07-11.

**Definition of done**: the pasture has a marked exit that walks you into a second zone (The Whisperwood, 48×48 forest) with its own ground palette, scenery props, chopable normal + oak trees (real `skills.json → woodcutting.actions` semantics), a bank chest, and three passive monsters (Field Chicken, Cave Goblin, Arcane Adept) rendered with their own models; walking back through the forest's exit returns you to the pasture; XP/logs/loot flush to the PocketRPG save exactly like mining/bull drops; disconnecting in the forest reconnects you to the forest; nothing from Phases 0–5.5 regresses.

### STEP 6.1 — Zone registry + validation
- `ZONES` in `WorldZone.ts` registers every `world/zones/*.json` (pasture + forest). `onConnect` closes 1008 `unknown_zone` when the room name isn't registered (today an unknown room silently becomes a second pasture).
- Zone JSON gains optional fields (types + validation in `shared/zone.ts`):
  - `objects[]` may have `type:'tree'` with `tree:'<woodcutting action id>'` (same placement rules as rocks).
  - `exits: [{id, x, z, toZone, toX, toZ, label}]` — exit tile and arrival tile walkable, ids unique, `toZone` registered, and the arrival tile must NOT itself be an exit tile in the target zone (no ping-pong). Cross-zone checks run in vitest over the real zone files (the runtime validator stays single-zone).
  - `props: [{model, x, z, rot?, scale?}]` — visual dressing only, allowed on blocked tiles (that's the point: author `#`, place a prop on it). Optional `palette: {walkableA, walkableB, blockedA, blockedB}` recolours the ground checker per zone.

### STEP 6.2 — Gather-node generalisation (Woodcutting)
- `mining.ts`: `WOODCUTTING_ACTIONS` from `skills.json → woodcutting.actions`; a `GATHER_SKILLS` table maps node skill → actions + verb/messages. `RockState` gains `skill: 'mining' | 'woodcutting'` (the `rock` field stays the action id — for a tree it holds `'normal'`/`'oak'`).
- `tick.ts` `startInteract`/`tickMining` read the action table from the node's skill; the level gate says "You need Woodcutting level 15 to chop this tree."; XP and product go to the node's skill/item. Anim stays `'mine'` (the hero clip is literally tree-chopping). Depletion/respawn reuse `ROCK_DEPLETED_TICKS` (8) and the existing `diff.rocks` wire field (semantic: gather-node state changes).
- Wire: trees ride `interact {kind:'rock', action:'chop'}`; the server validates the verb against the node's skill (mine↔mining, chop↔woodcutting).

### STEP 6.3 — Zone transitions
- Protocol: `welcome.zone` gains `name`, `exits` (positions + labels), `props`, `palette`; new server message `{t:'transition', zone, x, z}`.
- Server (in `tick()`, after movement): a player standing on an exit tile transitions — remove from `players` + `pendingLeaves`, **await** a flush with reason `'transition'` (drains pools exactly like `'disconnect'`: minted → save inventory, bankSourced → back to inventory, equipment snapshot — the pack re-seeds from the save in the next zone), **await** a `world_positions` checkpoint written with the TARGET zone/tile, then send `transition` and close (code 1000). The ordering is the correctness: save + position row must be durable before the client's next hello reads them. Known accepted risk (same as disconnect): a flush that fails all 3 retries loses the merge-back because the player object is discarded.
- Client: `{t:'transition'}` → store the target zone in `localStorage['world_zone']`, show the loading overlay ("Entering …"), `location.reload()` — boot connects to the stored zone. Every welcome also writes `zone.id` to that key, and `/api/world/session` returns the character's current `zone` from `world_positions` (stored at exchange time) so a fresh device lands in the right zone. A reload guarantees a clean scene/renderer; in-place rebuild is deliberately NOT attempted (leak-prone: renderer, RAF loop, intervals, listeners).
- Client rendering: each exit is a pulsing marker mesh + pickable — hover `Go-to the Whisperwood`, left-click walks to the exit tile (plain `walk`; stepping on it transitions server-side).

### STEP 6.4 — Scenery props
- `client/src/props.ts`: loads each distinct model once from `/models/props/<model>.glb` (template cache), clones per instance at `tileToWorld(x,z)` with optional Y-rotation/scale, no pick data. `world/scripts/build-props.mjs` processes the chosen Kenney nature-kit GLBs (CC0, already tiny — prune/resample only) into `client/public/models/props/`.
- Tree statics (interactive) get their own models the same way: healthy tree + `stump_old` in one wrapper; depleted toggles visibility (rocks keep their scale+darken treatment).

### STEP 6.5 — The Whisperwood + monsters
- `world/zones/forest.json`: id `forest`, name "The Whisperwood", 48×48, darker ground palette, ≥70% walkable, tree-line borders authored as `#` with pine props on top. Content: 6 normal trees + 3 oaks, 1 bank chest near the west entrance, exits west edge ↔ pasture east edge. NPCs (all passive, D5): 2× `field_chicken`, 2× `cave_goblin`, 1× `arcane_adept` — combat/loot/attribution ride the existing monster-agnostic adapter untouched.
- Models from the Quaternius Ultimate Monsters Bundle via a generic `world/scripts/build-monster.mjs` (clip-rename like `build-cow.mjs`; goleling maps `Flying_Idle`→idle, `Fast_Flying`→walk): `chicken.glb`, `goblin.glb`, `wizard.glb`. Client `createMonsterMesh(monsterId)` generalises `createCowMesh` with a per-monster `{url, bounds, targetSize}` registry (bounds printed by the build script — `Box3.setFromObject` is unreliable on skinned meshes) and keeps the box placeholder fallback. Examine strings added to `NPC_EXAMINE`. Update `docs/open-world-asset-coverage.md` statuses in the same PR.

### STEP 6.6 — Verification + bundled acceptance
Agent-verified before hand-off: full `world:check`; WS e2e — walk onto the pasture exit → `transition` received → reconnect to `forest` → welcome carries forest zone/statics → chop a tree (xp + logs) → kill a chicken (drops) → walk back through the forest exit → pasture welcome; D1 assertions that the transition flush landed items/XP and `world_positions.zone_id` flipped. Headless screenshots: forest ground palette, props, trees (healthy + stump), all three monsters, exit marker.
DEVELOPER TASK — **bundled manual script (DT-P4→P6, one pass, two devices where noted)**: covers the outstanding DT-P4 (shared bull kill, drag-reorder), DT-P5 (weapon visuals incl. bow/crossbow grip eyeball), Phase 5.5 (pathing feel, bank modal, pack actions, drop visibility between two devices), and Phase 6 (exit walk both ways, forest gathering at Woodcutting <15 and ≥15, monster kills + loot, reconnect-in-forest, PocketRPG save shows logs/XP/loot after). Reply "PHASES 4–6 ACCEPTED" (or itemised issues).

## 14) PHASE 7 — Lumbright town hub, Smithing + Cooking (added 2026-07-12 on developer instruction "continue")

Scope source: `docs/open-world-next-phases-scope.md` Phase 7 (decisions D2/D4/D5 apply: Lumbright is the canonical `world.json` town anchor, Smithing + Cooking are the first processing skills, all monsters passive). This closes the in-world loop: mine in the pasture → smelt + smith in town → fight → cook the beef.

**Definition of done**: a Lumbright zone (64×64 walled town) reachable by exits from both the pasture and the forest (and back); it contains a bank chest, a **furnace**, an **anvil**, and a **cooking range**; interacting with a station walks the player adjacent and opens a recipe panel listing what the pack can make from the real `skills.json` data; crafting consumes multi-input materials from the pack per tick and produces products/XP through the same session/flush pipeline as gathering (cooking can burn below `burnStopLevel`, exactly like the main game); three passive monsters (Bogling Sprite, Frostbite Imp, Marshfen Toad) roam outside the walls with their own models; nothing from Phases 0–6 regresses.

### STEP 7.1 — Shared recipe tables + protocol
- `world/shared/recipes.ts` (pure, client+server): `STATIONS` maps station type → `{ skill, verb, actions }` driven ENTIRELY by `src/data/skills.json` — `furnace` = smithing actions whose id starts `smelt_` (verb `smelt`), `anvil` = the remaining smithing actions (verb `smith`), `range` = cooking actions (verb `cook`). Action shape: `{ id, name, level, ticks, xp, product, materials: Record<itemId, qty>, burnStopLevel? }`. Never hand-author a recipe row.
- `world/shared/zone.ts` + protocol `StaticObject`: object types gain `'furnace' | 'anvil' | 'range'` (same placement rules as `bank_chest`). Editor catalog (`shared/catalog.ts` `objectCatalog`) lists all three.
- Protocol: client `{ t:'craft', station:'furnace'|'anvil'|'range', recipeId:string, qty:number }` (qty integer 1–28, else invalid → close 1008; qty is a request, server clamps to what materials allow). Station arrival event `{ e:'station', station, open:true }` (mirrors the bank-open flow). `interact {kind:'object'}` accepts actions `smelt`/`smith`/`cook` routed by the object's type.

### STEP 7.2 — Crafting state machine (server, real-engine semantics)
- On `craft`: require adjacency to a station object of that type, recipe in that station's table, session skill level ≥ `action.level` (refusal message `You need Smithing level N to make that.`), and ≥1 full set of `materials` in the pack. Store `player.crafting = { station, recipeId, remaining, progress }` (replaces mining/combat intents, cleared by walk/cancel like everything else).
- Per tick (`tick.ts`, pure like mining): anim `'mine'` (the only crafting-ish clip); after `action.ticks` ticks: re-check materials; consume every material (multi-input `removeItems` + `consumeUnits` per item — provenance pools must stay consistent); **cooking burn**: if `action.burnStopLevel`, roll the REAL `checkBurn(cookingLevel, action)` from `src/engine/skilling.js` — burnt → add `burnt_food`, grant **1 XP**, message `You accidentally burn the food.` (exact live-game semantics from `SkillingScreen.jsx`); else add `action.product` + grant `action.xp` via `grantSessionXp`. Products are **minted**; `{e:'inv'}` echo each completion. Decrement `remaining`; stop on 0, on missing materials, or when the product doesn't fit after removal (message `Your pack is full.`).
- Vitest: full smelt cycle (tin+copper → bronze bar, both inputs leave the pools correctly), smith consumes 2 bars for a scimitar, level gate, missing-material stop, qty clamp, burn path with injected RNG, pack-full stop, XP/level-up piggyback.

### STEP 7.3 — Recipe panel (client)
`world/client/src/crafting.ts`, a modal in the `bank.ts` mould: opens on `{e:'station', open:true}`, closes on walk-away/tap-out. One row per recipe in the station's table: item icon (itemIcon.ts), name, level tag (red when locked), material chips `have/need` (red when short), and Make 1 / Make 5 / Make All buttons (All sends qty 28) — disabled when locked or short. The list re-renders on `{e:'inv'}`/xp changes while open. All text via `textContent`.

### STEP 7.4 — Station statics + models
- `statics.ts` renders the three stations as pickables with default verbs (`Smelt`/`Smith`/`Cook`) + Examine. **Asset gap (confirmed 2026-07-12): the library has NO anvil/furnace/range models** — §2.1 sources: furnace = Medieval Village MegaKit `Prop_Chimney2` (brick chimney, texture-stripped like every [Standard] pack), range = Kenney nature-kit `campfire_bricks` (CC0), anvil = a primitive-composed mesh in code (dark metal box + horn) until a bespoke model lands (DEVELOPER TASK raised; DT-class C or Tripo generation, developer's choice). All three keep primitive fallbacks.

### STEP 7.5 — Lumbright zone + exits + monsters
- `world/zones/lumbright.json` (64×64, deterministic generation script like the forest's): walled town (walls authored `#` with castle/village wall props), a gate in the east wall and one in the south wall, market square with a well centrepiece, houses/market/mill buildings as props (KayKit Medieval Builder objects; Kenney town-kit lantern/cart dressing), roads, the bank chest near the square, furnace + anvil in a smithy corner, range in a kitchen corner, ≥70% walkable overall.
- Exits (both directions, validated by the exit-graph test): Lumbright east gate ↔ pasture west edge; Lumbright south gate ↔ forest north edge. Existing pasture-east ↔ forest-west exit unchanged (a triangle of zones).
- NPCs outside the walls (passive, D5): 1× `bogling_sprite` (Green Blob model), 1× `frostbite_imp` (Blue Demon, scaled down), 1× `marshfen_toad` (Frog) — via `build-monster.mjs` + `monsterModels.ts` registry + examine strings. Update `docs/open-world-asset-coverage.md` statuses in the same PR.
- Zone ambience: default daytime; palette a packed-earth/grass mix distinct from pasture and forest.

### STEP 7.6 — Verification + acceptance
Agent-verified before hand-off: full `world:check`; WS e2e — enter pasture with seeded ores + raw beef → walk west exit → Lumbright welcome (props/statics/npcs) → furnace: smelt bronze bars (both ores consumed, bars minted) → anvil: smith a bronze dagger → range: cook the beef (burn or cook, seeded level decides) → kill one town monster → exit back to pasture → D1 assertions: transition flushes landed products/XP in the save, `world_positions` flipped each leg. Headless screenshots: town walls/square/buildings, each station + its open recipe panel, all three monsters.
DEVELOPER TASK — manual script (DT-P7): real device(s) — walk pasture→Lumbright→forest→back through the gates; smelt/smith/cook end-to-end incl. a deliberate low-level burn; recipe panel usability on mobile (row height, Make All); verify PocketRPG shows the Smithing/Cooking XP + crafted items after; eyeball the stand-in furnace/anvil/range models and answer the open station-model DT. Reply "PHASE 7 ACCEPTED" (or itemised issues).

## 15) After Phase 7 (do not build ahead)

The Phase 8 tracks (armour outfits, Fishing + water zone, more monsters, green_dragon boss lair) live in `docs/open-world-next-phases-scope.md` — each gets its own guide section here before build starts. Run energy, potion boosts in world, prayer in world, ranged/magic combat, trading, PvP, raids remain out of scope. When Phase 7 is accepted, stop and await the developer's next instruction.

## 16) Quick reference — repo facts the agent will need constantly

- Tick: 600 ms. Inventory: 28. XP curve/cap: `src/engine/experience.js` (`getLevelFromXP`, 200M cap). Combat XP: 4/dmg style, 1.33/dmg HP (§5 CLAUDE.md).
- Mining data: `src/data/skills.json → mining.actions` (`tin`, `copper`: level 1, ticks 4, xp 17).
- The cow: `src/data/monsters.json → pasture_bull` (name "Pasture Bull", hp 8, attackSpeed 4, drops bones/raw_beef/cowhide @1.0, clue_scroll_medium @0.02).
- Items: `src/data/items.json` (Title Case names, `icon` emoji, `stackable` flag).
- JWT: `functions/_lib/jwt.js` — `signJWT(payload, secret, expiresInSeconds)`, `verifyJWT(token, secret)`.
- Save access: `functions/_lib/game/save.js` — `loadCharacterWithSave(env, characterId, identityId)`, `writeSave(env, characterId, saveObject, expectedRevision)`; blob: `save.stats[skill] = {xp, level}`; items via `functions/_lib/game/inventory.js` only.
- Audit: `functions/_lib/game/audit.js` — every grant flush emits one event.
- Combat engine: `src/engine/combat.js` — `createCombatState` (line ~29), `processCombatTick` (line ~409).
- Anti-pattern reminder: PvP's HTTP-poll-per-tick (`functions/api/pvp/match/[id]/tick.js`) is correct for PvP and **forbidden** here — the world never does per-tick durable writes or per-tick HTTP.
