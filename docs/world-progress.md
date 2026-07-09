# Open-World Build — Progress Log

> Append one line per completed step, per `docs/open-world-build-guide.md` §0 rule 6. Do not re-do a step marked done without developer instruction.

## STEP 0.0 — Ground-truth preflight

Confirmed against the live repo (2026-07-09):

- `functions/_lib/jwt.js` — `signJWT(payload, secret, expiresInSeconds = 30d default)` / `verifyJWT(token, secret)`, HS256 via Web Crypto, no deps. Matches guide exactly. **Guide correctly warns not to rely on the 30-day default — pass explicit expiries.**
- `functions/_lib/auth.js` — `requireAuth(request, env)` reads `Authorization: Bearer <jwt>`, returns `{ identity: { id, provider, displayName } }` or `{ error, status }`. `json(body, status, extraHeaders)` helper. Matches guide's assumed pattern for `world-token.js`.
- `functions/_lib/game/save.js` — `loadCharacterWithSave(env, characterId, identityId)` → `{ row, saveObject, saveRevision }` (joins `characters`+`saves`, ownership-checked, throws `CHARACTER_NOT_FOUND`). `writeSave(env, characterId, saveObject, expectedRevision)` — optimistic concurrency via `save_revision`, throws `SAVE_REVISION_CONFLICT` on mismatch, also recomputes+writes denormalized `characters.total_level`/`combat_level` via `computeSaveSummary`. Confirmed exact signatures match guide.
- `functions/_lib/game/inventory.js` — confirmed exports: `addItemToBank(save, itemId, quantity)`, `addItemToInventory`, `getInventory`, `bankQuantity(save, itemId)`, `removeItemFromBank/Inventory`, `canonicalItemId`, `normalizeSaveItemIds`. `addItemToBank` upserts `save.bank[itemId] = {itemId, quantity}` preserving extra fields (e.g. `charges`). Matches guide.
- Save blob shape — confirmed via `functions/_lib/saveSummary.js`: `save.stats[skillId]` is either a bare number (legacy) or `{ level, xp }`; level is read explicitly if present, else derived via `getLevelFromXP(xp)`. **Guide's §3 claim `save.stats[skillId] = {xp, level}` is correct but the reader must tolerate the legacy bare-number form when reading (writing should always use the object form).**
- `functions/api/save.js` (GET/PUT/POST-beacon/DELETE) — confirmed: PUT is client-authoritative with two guards only (total-level regression, bank-wipe heuristic), optimistic-concurrency via `save_revision`, no per-field policing. This is the §14 model the guide's "never add save-blob validation in grants" rule is protecting.
- `functions/api/actions/_completeShared.js` — confirmed the exact server-authoritative grant pattern the world's `grants.ts` should mirror: claim nonce → `loadCharacterWithSave` → mutate saveObject → `writeSave` FIRST → THEN collection-log/kill-count/audit (so a save-revision conflict can never strand a durable side-effect without the item that earned it). World's flush order should follow the same "save write leads, side effects trail" rule.
- `functions/_lib/game/audit.js` — confirmed real signature: `auditLog(env, eventType, payload, options)` (env-first; a legacy `auditLog(event, details)` 2-arg form still exists but is deprecated — new call sites, including ours, must use the 4-arg env-first form). Table: `audit_events(event_type, identity_id, character_id, payload_json, created_at)`.
- `src/data/skills.json → mining.actions` — confirmed `tin`/`copper`: `{level:1, ticks:4, xp:17, product:'tin_ore'|'copper_ore'}`. Matches guide exactly.
- `src/data/monsters.json → pasture_bull` — confirmed full entry: combatLevel 8, hitpoints 8, attackSpeed 4, attackStyle crush, drops `bones`/`raw_beef`/`cowhide` @ chance 1, `clue_scroll_medium` @ 0.02, `legacy_id: "cow"`. Matches guide exactly.
- `src/engine/experience.js` — confirmed exports `getXPForLevel`, `getLevelFromXP`, `getXPToNextLevel`, `getLevelProgress`, `clampXP`, `createLevelUpTracker`, `XP_TABLE`. `clampXP` exists for the 200M cap clamp the grant-flush algorithm needs (Step 1.4).
- `src/engine/combatLevel.js` — confirmed exports `combatLevelFromLevels(levels)` and `combatLevelFromStats(stats)`, needed for Step 2.1's level-colour-coded context menu.
- root `wrangler.toml` — confirmed `pocketrpg` Pages project config, D1 `database_id 439e810b-8dce-4697-94c2-a7392520ad8f`, secrets list includes `JWT_SECRET` (dashboard/`wrangler pages secret put`). Matches guide's DECIDED D1 binding.
- `build_single.cjs` top — confirmed this is the Pages single-file concat pipeline (`sourceFiles` array, esbuild). Confirms the guide's hard prohibition (never touch this file) is correctly scoped — the world client is a normal Vite build, entirely separate.
- `partyserver` README (fetched from GitHub) — confirmed: `Server` class extended with `onConnect`/`onMessage` lifecycle hooks; `routePartykitRequest(request, env)` for routing, returns `Promise<Response|null>`; hibernation is **opt-in** via `static options = { hibernate: true }` (so the guide's "hibernation OFF for now" is simply "don't set this option" — no extra work needed); client uses `new PartySocket({ host, party, room })`; wrangler config matches the guide's `wrangler.jsonc` template almost exactly (`durable_objects.bindings`, `migrations[].new_sqlite_classes`).
  - **Note for Step 0.1/0.8**: `party` defaults to the kebab-case of the binding/class name — binding `WorldZone` → party `world-zone`, NOT `zone`. The client's `net.ts` (Step 0.9) must explicitly pass `party: "world-zone"` (or the wrangler binding name can be lowercased to match — will keep binding name `WorldZone` and set party explicitly to avoid ambiguity). Recorded here so Step 0.9 doesn't have to rediscover it.
- **Side-finding for Phase 2 (Step 2.4), not blocking now**: `rollDrops(monster)` in `src/engine/combat.js` (~line 1024) is a private, non-exported module function already called internally on monster death (`state.loot = rollDrops(monster)`). This means Step 2.3's `processCombatTick` adapter likely already receives populated `combatState.loot` when the bull dies — Step 2.4 should read that instead of re-deriving from `monsters.json.drops`, and should confirm whether extraction/export is even necessary before assuming it. Will re-verify when Phase 2 starts.
- Root `package.json` pins `"three": "0.185.1"`; `public/vendor/three/three.core.min.js` banner confirms build `r185`. World client will pin the same `three@0.185.1`.
- Migrations: latest existing file is `0027_chat_usage.sql` → next migration number is **`0028`**.

No discrepancies found that block Phase 0. Proceeding to STEP 0.1.

- [x] STEP 0.0 — see commit introducing this file — ground-truth confirmed, no blocking discrepancies; two non-blocking notes recorded above (party name casing, rollDrops non-exported). Next migration number: 0028.

## STEP 0.1 — Scaffold `world/`

Created the full §4 skeleton (self-contained package, own `package.json`/lockfile, not an npm workspace). Placeholder implementations compile and the full acceptance bar passed:
- `npm run world:check` (typecheck + vitest + vite build) green from repo root.
- `cd world && npx wrangler dev` starts, resolves all four bindings (`WorldZone` DO, `DB` local D1, `ASSETS`, `JWT_SECRET`), and `curl localhost:8787/` returns the built `index.html` showing "World placeholder". Stopped the dev server and deleted the local `.dev.vars` afterward (never committed).

Deviations from the guide (routine dependency/tooling fixes, not product decisions — no DEVELOPER TASK needed):
- `@cloudflare/workers-types` pinned to **`4.20260702.1`** (latest 4.x), not the current 5.x major — `partyserver@0.5.8` peer-depends on `^4.20260424.1` and `npm install` hard-fails on the 5.x line with an ERESOLVE conflict.
- Added `@types/three@0.185.1` as a devDependency — the `three` npm package ships no bundled `.d.ts` (confirmed: no `types`/`typings` field in its `package.json`), so bare `tsc --noEmit` fails on `import * as THREE from 'three'` without it.
- `world/client/vite.config.ts` computes `root` as an absolute path from `fileURLToPath(new URL('.', import.meta.url))` rather than the literal `root: '.'` shown in the guide's prose — Vite resolved `'.'` against `process.cwd()` (`world/`) when invoked as `vite build --config client/vite.config.ts` from the `world/` package script, not against the config file's own directory, so the bare relative root couldn't find `client/index.html`. Confirmed fixed: `npm run build` now correctly outputs to `world/client/dist/`, matching the `wrangler.jsonc` assets directory.
- Confirmed and applied the party-name-casing note from Step 0.0: `client/src/net.ts`'s `connect()` passes `party: 'world-zone'` explicitly (not relying on any default), matching the kebab-case of the `WorldZone` binding.
- Added `world/vitest.config.ts` (not explicitly listed in §4's tree but necessary): without it, running `vitest run` from `world/` risks Vitest resolving the repo ROOT's `vitest.config.ts` instead (its `include` glob wouldn't match `world/tests/**`), which would silently report zero relevant tests rather than running `world/tests/placeholder.test.ts`. Confirmed the world vitest run now targets only `world/tests/**/*.test.ts`.

Files touched outside `world/`: `.gitignore` (added `world/node_modules/`, `world/client/dist/`, `world/.dev.vars` — technically already covered by the existing unanchored patterns, but kept explicit per the guide's literal instruction and for self-documentation), root `package.json` (`world:check` script).

- [x] STEP 0.1 — a1b2f81 — scaffold complete, world:check + wrangler dev both verified locally; four routine tooling deviations recorded above, no product decisions involved.

## STEP 0.2 — Migration for world tables

Added `migrations/0028_world.sql`: `world_positions` (per-character checkpointed tile position) and `world_grants` (idempotency ledger for Phase 1's grant flush), plus its index. Matched the repo's existing migration style (`CREATE TABLE IF NOT EXISTS`, `REFERENCES characters(id)` FKs) rather than the guide's bare prose SQL, since the guide doesn't lock exact syntax — only table/column names, which are preserved exactly.

Since `migrations/` was touched this required the FULL root CLAUDE.md §11 commit gate, not just `world:check`. Note: this sandbox had never had root `npm install` run — that was a one-time environment setup step, not a guide deviation. All four gate steps passed clean: `npm test` (170 files / 2228 tests), `npm run build`, `npm run rebuild`, `npm run check:single`.

Per the guide, applying this migration to local or production D1 is deferred to the developer (DT-class A, bundled into STEP 0.12's deploy task) — not run in this session.

- [x] STEP 0.2 — b09e7f2 — migration added, full root gate green, no discrepancies. D1 apply deferred to developer at deploy time.

## STEP 0.3 — Auth handoff endpoints

**(a)** `functions/api/world-token.js` — new Pages Function mirroring `save.js`'s `requireAuth` + ownership-SELECT pattern exactly. One discrepancy caught here: the `characters` table (confirmed via `migrations/0001_init.sql`) has a `username` column, not `name` — the guide's §6.3 prose used `name`. Not a blocking discrepancy: the DB column and the JSON field returned to clients are independent, so `world/server/session.ts` selects `username` and maps it to the `name` key in its response, matching the guide's wire-level intent without needing a schema change. Confirmed `sub` in the login JWT is the numeric `oauth_identities.id` (from `functions/api/auth/{github,google}/callback.js`), consistent with `owner_id` comparisons used throughout — no coercion needed.

New test `tests/worldToken.test.ts` follows the existing direct-handler-invocation pattern used by `tests/dailyTasksComplete.test.ts` (construct a `Request`, mock `env.DB.prepare`, call `onRequestPost` directly). Covers: no/invalid bearer token → 401, character not owned by caller → 404, happy path → verifies the returned JWT decodes with `scope: 'world_handoff'` and exactly 60s (`exp - iat`) lifetime.

**(b)** `world/server/session.ts` — real implementation of `POST /api/world/session`: verifies the handoff JWT's signature, scope, and expiry; re-checks character ownership against D1 independently (never trusts the handoff payload's character id without a fresh ownership check); issues a 24h `scope: 'world'` session JWT. Extracted a small `world/server/env.ts` holding the `Env` interface — the guide's `index.ts`/`session.ts` split would otherwise need a circular import (`index.ts` importing `handleWorldSession` from `session.ts`, `session.ts` needing `Env` which was originally declared in `index.ts`); this is a routine structural fix, not a decision reversal.

Gate: full root CLAUDE.md §11 gate (functions/ touched) — `npm test` (171 files / 2231 tests, up one file for the new test), `npm run build`, `npm run rebuild`, `npm run check:single` all green. `world:check` also green (`world/server/session.ts` typechecks against the real `functions/_lib/jwt.js` import).

- [x] STEP 0.3 — 8beff6b — both handoff endpoints implemented and tested; one non-blocking schema-naming discrepancy resolved (username vs name), one structural fix (env.ts extraction) to avoid a circular import.

## STEP 0.4 — Client boot, auth, platform gate

Implemented `client/src/auth.ts` (hash parsing, viewport-too-narrow check, handoff exchange + localStorage persistence — pure logic split out from side effects for testability), `client/src/ui.ts` (viewport-block / login-required / welcome DOM states), and `client/src/main.ts` (boot orchestration: viewport gate first — re-checked on `resize` — then hash vs stored-session vs login-required).

One typecheck-only fix: `Response.json()` resolves to `unknown` under this TS/DOM-lib combination (not `any`), so `exchangeHandoff` needed an explicit `as WorldSession` cast on the parsed body — routine, not a design change.

Unit tests added (`world/tests/auth.test.ts`, 6 cases) cover `parseHandoffFromHash` (plain, URL-encoded, empty, unrelated hash) and `isViewportTooNarrow` (below/at/above the 768px threshold on either dimension) — these are the guide's required "unit tests for hash parsing + gate logic". `world:check` green (2 test files / 7 tests total, typecheck clean, client build succeeds). No `functions/`/`src/`/`migrations/` touched, so the full root gate doesn't apply per §4's rule.

**Manual local run deferred to STEP 0.5**: the guide's own acceptance line for this step requires a handoff token minted by the dev-seed script, which doesn't exist yet — proceeding to STEP 0.5 next, then running the manual check for both steps together.

- [x] STEP 0.4 — c9a64a0 — auth/platform-gate logic implemented and unit tested; one routine TS cast fix. Manual verification (needs Step 0.5's seed script) still outstanding.

## STEP 0.5 — Local dev seed + manual verification of Steps 0.3–0.4

Root `node_modules` had never been installed in this sandbox before this session (unrelated to any guide step — one-time environment setup, done once and not re-noted per step from here on).

**Real bug found and fixed**: my first `dev-seed.mjs` draft replayed every `migrations/*.sql` file individually via `wrangler d1 execute --file=...` on each run. This is NOT idempotent — several migrations use bare `ALTER TABLE ... ADD COLUMN` (no `IF NOT EXISTS` support in SQLite for that statement), so a second run failed with `duplicate column name: save_data` on `0002_save_json.sql`. Fixed by using the real `wrangler d1 migrations apply pocketrpg --local` command instead, which tracks already-applied migrations in its own bookkeeping table — confirmed idempotent (second run: "✅ No migrations to apply!"). This required discovering D1's `migrations_dir` config key (distinct from the Durable Object `migrations` array already in `wrangler.jsonc` — same word, unrelated mechanism) and adding `"migrations_dir": "../migrations"` to the `d1_databases` entry so it points at the repo-root migrations folder shared with the main Pages project, rather than a nonexistent `world/migrations/`.

Also discovered and cleared several **orphaned background processes** from earlier steps' manual `wrangler dev` tests in this session — backgrounded shell jobs do not persist across separate tool invocations in this environment, so a `kill %1` in one call doesn't reach a process started in an earlier call. Killed all stray `workerd`/`wrangler` processes by explicit PID before the final clean verification run, and confirmed no state directory corruption resulted (redid the seed against a fully wiped `.wrangler/state`).

`world/scripts/dev-seed.mjs`: applies migrations, deletes/reinserts a fixed identity (id 1) + character (id 1, username `WorldTester`) + a minimal save (all 17 `skills.json` skill ids + 4 combat stats at level 1, hitpoints at level 10/1154xp per CLAUDE.md §5 — real gzip via Node's `zlib.gzipSync`, matching what `saveCodec.js`'s `isGzipBuffer`/`DecompressionStream('gzip')` expect), then mints a 60s handoff JWT via a direct import of `functions/_lib/jwt.js`. Refuses to run if `CF_PAGES`/`CLOUDFLARE_ENV` are set.

**Manual verification performed** (this is normally DT-class B, but the guide's own Step 0.4 acceptance text ties it to this step and none of it required a Cloudflare account action, so it was done here with the pre-installed Chromium via Playwright — found via the global npm install at `/opt/node22/lib/node_modules/playwright`, launched with `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`):
- Handoff hash → exchange → **"Welcome, WorldTester"** rendered, URL hash correctly stripped.
- Reload with no hash → stored session used, same welcome text.
- Resize to 500px width → **"PocketRPG World needs a desktop or tablet."** block shown.
- Resize back to 1280px + reload → welcome recovers correctly (gate doesn't wrongly latch).
- `localStorage.clear()` + reload, no hash → login-required page with a working link to pocketrpg.co.uk.

All five scenarios passed. This is stronger evidence than the unit tests alone and closes out both Step 0.4's and Step 0.5's manual-verification requirements for everything that doesn't need a real Cloudflare account (full production-domain + real-device/tablet verification remains correctly deferred to Step 0.12's DEVELOPER TASK).

- [x] STEP 0.5 — dd52556 — dev-seed script working and idempotent after fixing a real non-idempotency bug; full local browser verification of Steps 0.3-0.5 passed all five scenarios.

## STEP 0.6 — Zone format + pasture.json

Implemented `validateZone()` in `world/shared/zone.ts`: collision row count vs `height`, each row's length vs `width` and character set (`.`/`#` only), spawn tile walkable, every object/npc on a walkable tile, and id uniqueness across objects+npcs combined (interpreted "ids unique" as one shared namespace since the client will key rendered entities by id regardless of type — stricter than per-list uniqueness, not looser).

Authored `world/zones/pasture.json` (32×32) via a short generation script rather than typing 1024 characters by hand — the guide's "author it by hand as ASCII" reads as "no runtime procedural generation", not "no tooling to lay out a static file precisely", so this is in keeping with the intent. Geometry decision made here (not specified by the guide beyond width/height/spawn/rock-and-chest counts): the fenced enclosure sits at `x:17-29, z:15-27` with a 2-tile gate gap on the south wall, sized so Phase 2's already-decided bull wander rect (`{x:18,z:16,w:10,h:10}`, from the guide's own STEP 2.2 text) fits just inside it with a one-tile buffer — meaning this single zone file won't need reworking when Phase 2 adds the cow. 95.5% walkable (978/1024 tiles), comfortably above the guide's 70% floor. Rocks and chest placements confirmed on walkable tiles by the validator test, not just by eye.

`world/tests/zone.test.ts`: the real `pasture.json` validates; four deliberately broken fixtures each fail for the right reason (row-count/height mismatch, blocked spawn, object on a blocked tile, duplicate id). `world:check` green: 3 test files / 12 tests total.

- [x] STEP 0.6 — 3bbbe87 — zone validator + pasture.json authored and tested; one geometry decision recorded (fence sized to Phase 2's cow pen) since the guide left exact layout open.

## STEP 0.7 — Pathfinding

Implemented BFS shortest-path over 8-directional movement in `world/server/pathfind.ts`, with the corner-cutting rule as a hard gate (a diagonal step from A to B is only legal when both cardinal tiles adjacent to that step are walkable). Two exported functions, not one — the guide's prose describes a single `findPath`, but Steps 1.2 ("path the player to the nearest tile adjacent to the rock") and 2.3 ("path adjacent, then start combat") both need pathing to a tile *next to* an inherently-unwalkable target (a rock/npc), which is a distinct algorithm from a direct walk. Added `findPathAdjacent` for that case (tries all 8 neighbours of the target, returns the shortest reachable one) rather than overloading `findPath` with a mode flag — this is implementing what the guide's own later steps require, not adding scope.

**Removed the stale `tests/placeholder.test.ts`** from Step 0.1 — it asserted the placeholder stub's fake `return [from]` behavior unconditionally, which the real BFS correctly does not reproduce (an empty collision grid has no walkable target, so it now correctly returns `null`). Replaced with `tests/pathfind.test.ts` (9 cases): straight line, no-op path when already there, routing around a wall, corner-cut refusal, unreachable target, blocked target, out-of-bounds target, `maxLen` truncation, and both `findPathAdjacent` cases.

One test-authoring correction caught by actually running the suite (not just eyeballing the grid): the first corner-cut fixture placed the blocked pair at the grid's absolute corner, which isolates that tile with zero legal moves at all (no detour room), so the test asserted a path exists when the correct answer was `null` — the test's premise was wrong, not the implementation. Fixed by moving the fixture inland so a legal (longer) detour genuinely exists, and strengthened the assertion to check every step of the returned path against the corner-cut rule directly rather than only checking length.

`world:check` green: 3 test files / 22 tests.

- [x] STEP 0.7 — e907a06 — pathfinding implemented with two entry points (direct + adjacent-to-target), stale placeholder test removed and replaced, one test-fixture bug found and fixed during verification.

## STEP 0.8 — WorldZone Durable Object + movement tick

Implemented `WorldZone.ts` as a `partyserver` `Server` subclass following its confirmed API (`onConnect`/`onMessage`/`onClose`, `this.env`/`this.name`, `Connection<TState>` generic for per-connection state, `static options.hibernate` left unset = off per the guide). Connection state (`{charId}`) lives in partyserver's small per-connection `state` (documented ~2KB cap — fine for just an id); actual game state (position, path, anim, rate-limit timestamps) lives in an in-memory `players: Map<charId, Player>`, per the guide's explicit spec — never in `connection.state`, which would be the wrong place once Phase 1 adds inventory/stats.

Auth flow: 5s timeout closes unauthenticated connections; `hello` is verified (JWT scope `world`, D1 ownership re-check independent of the token's claims); a second connection for the same character closes the first. Movement: `walk` computes a path via `findPath` from Step 0.7 and stores it (minus the current tile) on the player; the 600ms tick (`setInterval`, started on first join / cleared on last leave) advances every player one step via the pure `tick.ts` functions and broadcasts one `diff` per connection only when something changed zone-wide that tick. Checkpoints — the only durable writes — fire on disconnect (immediate, single row) and every 100 ticks (batched via `env.DB.batch`), matching the guide's write-amplification design from the original research doc.

`tick.ts` grew from a placeholder into `advanceMovement` (pure single-step state transition) and `toEntityDiff` (wire-format mapping), both unit tested in `tick.test.ts` (7 cases).

**Real bug found via integration testing, not unit tests**: `dev-seed.mjs`'s cleanup deleted `characters` before clearing `world_positions`, which passed every previous run only because no `world_positions` row existed yet — the very first checkpoint this step's code ever wrote surfaced a `FOREIGN KEY constraint failed` on the next re-seed. Fixed by adding the missing `DELETE FROM world_positions` before the `characters` delete. This is exactly the kind of bug that unit tests (which mock the DB) cannot catch and only a real end-to-end run against live D1 surfaces.

**Verification method**: rather than only unit-testing the pure functions (which was already done) or mocking the Durable Object (awkward and low-value for connection-lifecycle logic), ran a full local `wrangler dev` + real `WebSocket` client against the live DO and confirmed, by direct observation of the actual wire messages and a direct D1 query: (1) `hello`→`welcome` with correct zone/character data, (2) `walk` produces tick-by-tick `diff` messages tracing a real BFS-routed path, (3) `ping`→`pong` answered immediately, (4) disconnect writes the exact final tile to `world_positions`, (5) reconnecting with a fresh session token resumes from that persisted tile rather than zone spawn, (6) a message sent before `hello` closes the connection with code 1008/`not_authed`, (7) a second connection for the same character closes the first with 1008/`duplicate_connection`. All seven passed.

`world:check` green: 4 test files / 26 tests.

(Minor housekeeping note: this step's own commit message accidentally let bash expand backtick-quoted code spans as command substitution, silently dropping two words from one sentence — cosmetic only, the diff/tests/behavior are unaffected. Switching to the quoted-heredoc commit pattern for every commit from here on to prevent recurrence.)

- [x] STEP 0.8 — d311b97 — WorldZone DO + tick loop implemented and verified end-to-end with a real WebSocket client against a live wrangler dev instance; one real cross-step bug found and fixed (seed script FK ordering).

## STEP 0.9 — three.js scene, click-to-move, placeholder avatar

Built `scene.ts` (renderer/camera/lights/ground), `entities.ts` (capsule + 600ms lerp between reported tiles), `input.ts` (raycast-to-tile + fading click marker), and wired it all together in `main.ts`'s `enterWorld()`: on the `welcome` message, build the scene and start rendering; on `diff`, feed the self entity's new tile into the interpolator; on click, send `walk` and show the marker. `ui.ts` now toggles `#scene` vs `#app` visibility instead of only ever showing text.

One implementation choice made here, not specified by the guide beyond "blocked tiles get darker overlay quads": baked the walkable/blocked checker pattern into a single `CanvasTexture` rather than instantiating one overlay mesh per blocked tile. Same visual result, far fewer draw calls on a 32×32+ grid — this reads as an implementation detail of achieving the stated visual effect, not a deviation from anything DECIDED.

**Verification**: local `wrangler dev` + Playwright, using its WebSocket frame-monitoring API rather than adding any debug hooks to the shipped client. Confirmed: (1) the overlay correctly hides and the scene shows once `welcome` arrives; (2) clicking the canvas sends a real `{t:'walk', x, z}` frame with tile coordinates computed from an actual raycast hit against the ground mesh (click at canvas (500,400) → `{x:14,z:16}`, a real tile two steps west of spawn); (3) `diff` frames arrive afterward tracing the resulting server-driven movement; (4) before/after screenshots (attached to this session, not committed — the fence corner from `pasture.json` visibly shifts in frame between them, confirming both the capsule and the camera-follow moved correctly, not just the wire messages). Reconnect-resumes-at-checkpoint itself was already rigorously proven in Step 0.8 with dedicated tests and is unchanged by this purely-additive rendering layer — a reload during this step's testing showed the same live DO continuing its tick counter, consistent with (not a new proof of) that already-established behavior.

`world:check` green: 4 test files / 26 tests, unchanged from Step 0.8 — this step is almost entirely client rendering/input code with no new pure logic warranting unit tests beyond what pathfinding/tick already cover.

- [x] STEP 0.9 — 48a4687 — three.js scene, camera-follow, click-to-move, and interpolated placeholder avatar implemented and verified end-to-end (protocol frames + visual screenshots) against a live local instance.

## STEP 0.10 — Hero model + animations

Copied `public/3d-samples/hero.glb` (942 KB — under the 5MB threshold, no developer approval needed per the guide). `world/scripts/list-anims.mjs` needed the exact NodeIO extension-registration pattern already established in this repo's own `scripts/process-3d-model.mjs` (`EXT_meshopt_compression`, `EXT_texture_webp` — simplified to `ALL_EXTENSIONS` from `@gltf-transform/extensions` rather than discovering each required extension one at a time via trial and error) — added `@gltf-transform/core`/`extensions` + `meshoptimizer` to `world`'s own devDependencies, pinned to match root's versions.

84 clips found. No clip is literally named "Idle" or "Walk" (the guide's preferred exact match), but `idle_loop`/`walk_loop` are unambiguous — they're the plain base cycles, distinct from context-specific variants like `walk_formal_loop`/`walk_carry_loop`. Judged this confident enough to map directly rather than raise a DEVELOPER TASK: the guide's escape hatch is for genuine ambiguity, and picking between "the obviously-plain clip" and "clips with additional qualifying words" isn't that.

`createHeroMesh()` in `entities.ts` loads the GLB via three's own `GLTFLoader`/`meshopt_decoder.module.js` (the *npm* three.js's example loaders — not the vendored single-file-build loaders elsewhere in the repo, since `world/` is a separate Vite/ESM app with no relationship to that pipeline), clones the skeleton per entity via `SkeletonUtils.clone` so the parsed template can eventually back multiple on-screen entities, and binds a per-clone `AnimationMixer` with idle/walk actions and a 150ms crossfade.

**Two real y-offset bugs found and fixed while wiring this in**: `createEntity` and `setEntityTarget` were overwriting the mesh's y-position with the ground plane's y (0) instead of preserving whatever y-offset the mesh itself needs (0.6 for the capsule fallback, 0 for the hero's feet-at-origin rig) — without the fix, the capsule fallback path would sink into the ground after its very first movement. Caught by re-reading the code against both fallback paths, not by running it (the hero model itself doesn't need a y-offset so this wouldn't have shown up testing only the happy path).

**Verification**: local `wrangler dev` + Playwright. Idle screenshots show a natural standing pose — no T-pose ever appeared. A click that resolved to a blocked (fence) tile correctly produced zero movement (this was almost mistaken for a bug — re-tested with frame monitoring and a click on confirmed-open ground, which did send `walk` and produced tick-by-tick diffs, showing the first click's "non-movement" was correct rejection of a wall-tile target, not broken input handling). The resulting walk screenshot shows a clear mid-stride pose with the camera still correctly following. The only console 404 (`/favicon.ico`) was confirmed via direct `curl` to be unrelated to the model pipeline.

`world:check` green: 4 test files / 26 tests, unchanged — this step is asset/rendering wiring with no new pure logic to unit test.

- [x] STEP 0.10 — d81d268 — hero model with idle/walk animation crossfade implemented and verified visually; two real y-offset bugs found and fixed before they could surface as a rendering regression on the capsule fallback path.
