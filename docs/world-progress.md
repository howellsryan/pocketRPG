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

## STEP 0.11 — PocketRPG entry button

**Real discrepancy from the guide's assumed file layout**: there is no `SettingsScreen.jsx` anywhere in `src/screens/`. The "Settings" label in the in-game nav (`navTabs.js`'s `GAME_FRAME_BOTTOM_LEFT_TABS`/`DESKTOP_NAV_TABS`) routes to `SCREENS.HELP`, which renders `HelpScreen.jsx` — confirmed by tracing the nav tab's `id` through to the screen registry rather than guessing from the filename. This is exactly the kind of thing the guide's "locate via grep" instruction anticipates; not a blocker, just the real target file.

`src/cloud/api.js`: added `requestWorldHandoff()` to the existing `api` object, matching the exact call shape of `resetOneLife` (zero-payload POST) so it inherits the shared `request()` wrapper's auth header, `X-Character-Id` header, timeout, and 401-handling for free — no new fetch logic.

`src/screens/HelpScreen.jsx`: the button is gated on `localStorage.pocketWorldBeta === '1'` and styled identically to the existing `SETTINGS_NAV_LINKS` buttons (48px min-height, `GameIcon` + label + chevron), so the 44px tap target requirement is inherited from an already-correct pattern rather than re-derived. `WORLD_ORIGIN` is a clearly-commented placeholder workers.dev URL pending STEP 0.12's deploy task.

Confirmed via `build_single.cjs` that `HelpScreen.js` is listed in `GAME_CHUNK_FILES`, not core — consistent with it being reachable only from in-game navigation. The one new import this step adds (`src/cloud/api.js`) is itself a core-level module, so a chunk file importing it is the safe direction under CLAUDE.md §12 (core must never reference a chunk-only binding; the reverse is fine).

Full root CLAUDE.md §11 gate (src/ touched): `npm test` (171 files / 2231 tests), `npm run build`, `npm run rebuild`, `npm run check:single` — all green.

- [x] STEP 0.11 — 98fadfd — entry button added to the real Settings screen (HelpScreen.jsx, not the guide's assumed filename); full root gate green.

## Phase 0 status: code-complete, STEP 0.12 blocked on DEVELOPER TASK

Steps 0.0-0.11 are done, tested (`world:check` and/or the full root gate as each step required), and pushed. STEP 0.12 (deploy + acceptance) is entirely DT-class A/B — first `wrangler deploy`, production `JWT_SECRET`, remote D1 migration, and a real-device manual pass — none of which this session can perform. Stopping here per the guide's rule 1: Phase 1 does not start until the developer confirms "PHASE 0 ACCEPTED".

## STEP 0.12 (in progress) — first-deploy feedback fixes

Developer performed the first real `wrangler deploy` (DT-class A) and reported the deployed workers.dev host (`pocketrpg-world.rlh.workers.dev`), that only the **preview** D1 (`pocketrpg-preview`) has the migration applied so far, and that clicking the Settings-screen button landed on the world app's own login-required screen instead of entering the world. Three fixes, all routine (no new DECIDED items, no DEVELOPER TASK needed):

1. **`world/wrangler.jsonc`** — `d1_databases[0]` was still bound to production (`pocketrpg`, `439e810b-…`). Repointed to preview (`pocketrpg-preview`, `59233295-f492-4113-94da-90034d84a6a4`, matching root `wrangler.toml`'s `[env.preview]` block) per explicit developer instruction, since only preview has the migration applied. `world/scripts/dev-seed.mjs`'s two hardcoded `wrangler d1 …` CLI invocations updated from `'pocketrpg'` to `'pocketrpg-preview'` to match — wrangler resolves local D1 by the `database_name` string declared in config, so these had to move together or local dev would break.
2. **`src/screens/HelpScreen.jsx`** — `WORLD_ORIGIN` was `https://pocketrpg-world.workers.dev`, missing the Cloudflare account subdomain; the real deployed host is `pocketrpg-world.rlh.workers.dev`. This was very likely the actual root cause of the reported bug: the button's `window.open()` target didn't resolve, so the developer was seeing the world app's login-required screen from navigating to the correct URL directly (with no handoff hash), not from a working button flow. Fixed to the real host.
3. **`world/client/src/auth.ts`** — `pocketRpgUrl()` (the "Go to PocketRPG" link on the login-required screen) was hardcoded to production. Refactored into a pure `pocketRpgUrlForHost(hostname)` (mirrors the existing `isViewportTooNarrow` pure-function style) that returns production only when the world app itself is being served from `world.pocketrpg.co.uk`, and `preview.pocketrpg.pages.dev` for everything else (the current workers.dev host, localhost, etc.) — matches the developer's explicit instruction. Two new unit tests added to `world/tests/auth.test.ts`.

Also answered (no code — informational): custom-domain setup for `world.pocketrpg.co.uk` is free and doesn't require buying anything, since `pocketrpg.co.uk` is already an active zone on the same Cloudflare account (Workers custom domains auto-manage DNS + TLS for hostnames within a zone you control) — see chat for the exact dashboard steps.

`world:check` green (4 test files / 28 tests, +2 for `pocketRpgUrlForHost`). `HelpScreen.jsx` is a `src/` file, so the full root CLAUDE.md §11 gate was run (not just `world:check`): `npm test` (171 files / 2231 tests), `npm run build`, `npm run rebuild`, `npm run check:single` — all green.

- [x] STEP 0.12 fixes — 56dcbc9 — three post-deploy bugs fixed (D1 binding, entry-button URL, env-aware redirect); full root gate green. STEP 0.12 itself remains open pending the developer's custom-domain setup, production JWT_SECRET/migration (whenever production D1 is ready), and the manual acceptance pass ending in "PHASE 0 ACCEPTED".

## STEP 0.12 (in progress) — diagnostics, referrer-based redirect, build-time beta toggle

Developer set up the `world.pocketrpg.co.uk` custom domain and reported the login-required screen persisting, plus a supplied handoff JWT for inspection. Decoded it (`sub:1, character_id:1, scope:'world_handoff'`, well-formed, 60s lifetime) — confirms `/api/world-token` on the PocketRPG side works correctly; the failure is downstream in the exchange. Diagnosis, not guesswork: `handleWorldSession`'s character-ownership SELECT runs against `env.DB`, which — per the previous fix, at the developer's own explicit instruction — is bound to **preview** D1. A handoff minted from the real production PocketRPG site carries a production `character_id`/`sub`, which genuinely does not exist in preview D1, so the lookup correctly returns nothing and the exchange correctly fails with 404. This was never a logic bug; it was invisible because neither side logged anything and the client's `catch` swallowed the failure into a generic screen. (The "SessionIDFound" console object the developer noticed does not appear anywhere in this repo's `src/` or `world/` — unrelated browser/extension noise, not this codebase.)

Three fixes, all routine:
1. **`world/server/session.ts`** — each rejection branch (missing handoff, bad JWT/expiry, wrong scope, no character row) now `console.error`s the specific reason (never the token/secret itself) — visible via `wrangler tail` or the Cloudflare dashboard's live logs.
2. **`world/client/src/auth.ts`+`main.ts`** — `exchangeHandoff` now reads and `console.error`s the failure response's status + JSON body (instead of discarding it) and includes it in the thrown `Error`'s message; `boot()`'s catch logs the caught error instead of swallowing it silently.
3. **Referrer-based redirect** — the developer noted the "Go to PocketRPG" link pointed at production while testing from preview. The previous hostname-based heuristic (`pocketRpgUrlForHost`) was actively wrong for this exact situation: `world.pocketrpg.co.uk` now genuinely can be reached from either PocketRPG site, so guessing from the *world app's own* hostname can't be correct in general. Replaced with `resolvePocketRpgUrl(referrer, worldHostname)`: prefers `document.referrer` when it's one of the two known PocketRPG origins (never trusts an arbitrary referrer — no open-redirect risk), falling back to the old hostname heuristic only when there's no usable referrer (a bookmarked/reloaded world tab). `document.referrer` is set automatically by the browser on `window.open()`, so this needed no protocol/wire changes. Test file renamed/expanded accordingly (7 cases now).
4. **Build-time world-beta toggle**, replacing the `localStorage.pocketWorldBeta` flag entirely per explicit developer request ("do this through wrangler like we do for others"): investigated the actual established mechanism for a client-bundle toggle in this repo first rather than assuming `wrangler.toml [vars]` would work — confirmed via `build_single.cjs`'s own comment that `[vars]` are a `functions/**`-only runtime binding and explicitly do **not** reach the client bundle, which is exactly why the existing `pocketEnable3D` 3D-render flag already uses a `CF_PAGES_BRANCH`-derived build-time bake instead (with an `Enable3dRender` override var). Replicated that exact pattern: `build_single.cjs` now also bakes `pocketWorldBetaEnabled` into the game chunk (preview branches → enabled, `main`/production → disabled, `EnableWorldBeta` env var as an explicit override, same fail-safe-disabled-with-no-branch-info default). `HelpScreen.jsx` reads it through the same `typeof pocketWorldBetaEnabled !== 'undefined'` guard three3d.js already uses for `pocketEnable3D` (Vite dev never defines these globals; guard defaults to enabled there, matching the 3D flag's precedent). This closes the root cause as a side effect, not just the symptom: production will no longer show the button at all once deployed, so a production character can never again be handed to a preview-bound world worker — the exact failure mode just diagnosed becomes structurally impossible, not just better-logged.

`world:check` green (4 test files / 29 tests). `src/`/`build_single.cjs` touched → full root CLAUDE.md §11 gate run: `npm test` (171 files / 2231 tests), `npm run build`, `npm run rebuild` (confirmed the `World beta button: disabled (EnableWorldBeta=unset, CF_PAGES_BRANCH=unset)` bake log line — correct local fail-safe default), `npm run check:single` — all green.

Still open for the developer: redeploy the world Worker with this commit, set `EnableWorldBeta` (or rely on `CF_PAGES_BRANCH`) on the PocketRPG Pages project's preview builds, retry the button from **preview** (not production) so the handed-off character actually exists in the preview D1 this Worker is bound to, and report back what the new console/server logs show if it still fails.

- [x] STEP 0.12 diagnostics — 3bd11ea — root cause diagnosed (preview/production D1 vs character mismatch, not a logic bug), structured logging added client+server, referrer-based redirect replacing the hostname heuristic, localStorage beta flag replaced with a CF_PAGES_BRANCH-derived build-time bake matching the existing 3D-render flag's exact mechanism. Full root gate green.

## STEP 0.12 (in progress) — production/preview environment split, groundwork for auto-deploy

Developer asked whether the world Worker auto-deploys like the PocketRPG Pages project does. It didn't — confirmed by checking the repo directly rather than assuming: `.github/workflows/` has no deploy step at all (`logic-regression.yml` only runs `npm run ci` as a check; `discord-changelog.yml` only posts to Discord on merge), so PocketRPG's actual auto-deploy is Cloudflare Pages' own Git integration (dashboard-connected, not GitHub Actions) — confirmed this is also where `CF_PAGES_BRANCH` comes from, the same variable `build_single.cjs` already reads. Researched Cloudflare's direct equivalent for Workers (**Workers Builds**: Git-connected, production branch → `wrangler deploy`, other branches → `wrangler versions upload` with their own preview URL) before proposing it, rather than assuming feature parity with Pages.

Setting up Workers Builds requires a real environment split first — a single default environment can't cleanly serve both a production custom domain (real D1) and preview branch builds (preview D1) at once. Restructured `world/wrangler.jsonc` to mirror root `wrangler.toml`'s existing production/`env.preview` shape. Verified two non-obvious Cloudflare rules against the docs *before* writing the config, not after finding a broken deploy: (1) bindings (`assets`, `durable_objects`, `d1_databases`) are **not inherited** by named environments — each must be fully redeclared inside `env.preview` even though only the D1 target differs; (2) `migrations` (the Durable Object class-migration tag) is the opposite — **top-level only**, and must NOT be repeated inside `env.preview`, or wrangler rejects the config.

Result: top-level (production, plain `wrangler deploy`) now points at the real production D1 (`pocketrpg`, `439e810b-…`) — this is the existing deployment the developer's new `world.pocketrpg.co.uk` custom domain already points at, so redeploying in place is all that's needed to fix it. New `env.preview` (deployed via `wrangler deploy --env preview`, a distinct Worker service `pocketrpg-world-preview` with its own workers.dev URL) points at `pocketrpg-preview`, matching what local dev has used all along.

Follow-on fixes so local tooling still resolves the right database now that `pocketrpg-preview` only exists inside `env.preview`: `world/package.json`'s `dev` script now runs `wrangler dev --env preview` (previously bare `wrangler dev`, which would now default to *production* bindings for local dev — a real behavior change this restructuring would otherwise have silently introduced); added `deploy:preview`; `dev-seed.mjs`'s two `wrangler d1 …` calls now pass `--env preview` (local-only, never touches remote/production D1).

**Verified end-to-end locally, not just typechecked**: wiped `.wrangler/state`, re-ran `dev-seed.mjs` against the restructured config (succeeded), booted `wrangler dev --env preview`, confirmed its printed bindings table shows `env.DB (pocketrpg-preview)` (proving the environment resolved correctly, not silently falling through to production), then exchanged a freshly-minted handoff token against `POST /api/world/session` for real — `200 OK` with a valid session token and the seeded character's name. This is the same exchange path that was failing in production/preview confusion earlier in this step; confirmed it now succeeds cleanly under the new config before handing anything back to the developer.

`world:check` green (unchanged: 4 test files / 29 tests — this step is deploy config, no new logic). Only `world/` files touched (`wrangler.jsonc`, `package.json`, `scripts/dev-seed.mjs`) — no `src/`/`functions/`/`migrations/` changes, so `world:check` alone satisfies the commit gate per §4's rule.

Handed back to the developer as the next DEVELOPER TASK (DT-class A, Cloudflare account actions this session cannot perform): set `JWT_SECRET` for the new `env.preview` deployment (`cd world && npx wrangler secret put JWT_SECRET --env preview`, **same value** as production's — PocketRPG's own production and preview Pages deployments already share one `JWT_SECRET`, so every leg of this handoff chain must match); apply `migrations/0028_world.sql` to the real production D1 too (`npx wrangler d1 migrations apply pocketrpg --remote` from repo root) since production now points at it and currently doesn't have it, even though the button is disabled there for now; redeploy production in place (`cd world && npm run deploy`) — the existing custom domain follows automatically, no dashboard change needed; deploy preview for the first time (`npm run deploy:preview`) and send back the printed workers.dev URL so `HelpScreen.jsx`'s `WORLD_ORIGIN` (currently still the old undifferentiated URL) can be pointed at the correct preview-only Worker; then connect Workers Builds in the dashboard (Workers & Pages → `pocketrpg-world` → Settings → Builds → connect this GitHub repo, production branch `main`, preview build command `npm run deploy:preview` run with cwd `world/`) for real auto-deploy going forward.

- [x] STEP 0.12 environment split — 31b651c — production/preview wrangler.jsonc split modeled on root wrangler.toml, two Cloudflare inheritance rules confirmed against docs before writing (bindings non-inheritable, migrations top-level-only), local tooling updated to match, verified end-to-end with a real seed → dev → handoff-exchange run against the new config. `world:check` green. Groundwork for Workers Builds auto-deploy; the dashboard connection itself is a DEVELOPER TASK.

## STEP 0.12 — deploy follow-through

Developer hit `wrangler deploy`'s config-drift confirmation prompt (`workers_dev`/`preview_urls` true→false, plus a `d1_databases` diff) and asked whether to accept it. Verified against Cloudflare's docs rather than guessing: `workers_dev`/`preview_urls` control only the `*.workers.dev` URL and version-preview subdomains, are completely independent of custom-domain routing, and a recent Wrangler release changed the default for an unset key from `true` to `false` — explaining the diff without any config mistake on our side. Confirmed safe (production is meant to be reached only via `world.pocketrpg.co.uk` going forward; Cloudflare's own guidance is custom-domain-only for production anyway) and pinned both flags explicitly per environment (`false` top-level, `true` under `env.preview`) so the prompt won't recur and intent is documented rather than left to a default that already changed once.

Production redeployed successfully; developer then deployed preview for the first time (`npm run deploy:preview` — first attempt failed with "Missing script" because the local Windows checkout hadn't pulled the commit that added it, resolved with `git pull` + `npm install`) → `https://pocketrpg-world-preview.rlh.workers.dev`. Updated `HelpScreen.jsx`'s `WORLD_ORIGIN` to that URL (it was still pointing at the old single-deployment URL, which is now production and — since the beta button only ever renders on preview builds — would never have been reachable from the button anyway). `src/` touched → full root gate run (`npm test` 171 files/2231 tests, `npm run build`, `npm run rebuild` — confirmed `World beta button: disabled (EnableWorldBeta=unset, CF_PAGES_BRANCH=unset)`, the correct local default — `npm run check:single`) — all green.

**Still outstanding before the button can be end-to-end tested from preview**: `JWT_SECRET` has not yet been confirmed set on the new `env.preview` deployment (`cd world && npx wrangler secret put JWT_SECRET --env preview`, same value as production) — without it every handoff exchange will fail signature verification. Also still outstanding: applying `migrations/0028_world.sql` to production D1, and connecting Workers Builds for auto-deploy. None of these are blocking issues found in the code — they're the remaining items from the DEVELOPER TASK list two steps up.

- [x] STEP 0.12 deploy follow-through — cec6b44 — config-drift prompt diagnosed and explained (safe, pinned explicitly), preview deployed, WORLD_ORIGIN repointed at it. Full root gate green. JWT_SECRET for preview + production migration still outstanding before a real end-to-end button test will succeed.

## Merged `preview` branch into this branch

Developer's Workers Builds preview connection was pointed at the wrong root directory (building from repo root instead of `world/` — fixed via dashboard settings, not code) and had already squash-merged an earlier snapshot of this branch's `world/` work into `preview` via PR #718, alongside unrelated feature commits (leaderboard player profiles, inventory reordering/full-pack UI, Active Play while Skilling QoL, a changelog-automation tweak). Merged `origin/preview` into this branch to reconcile.

One real conflict (`world/package.json`, add/add on the `"ci"` script line added after PR #718's snapshot — resolved by keeping it); everything else, including `world/package-lock.json`, auto-merged cleanly. Full root gate green post-merge (172 files/2242 tests, build, rebuild — both `pocketEnable3D`/`pocketWorldBetaEnabled` bakes confirmed correct, check:single) plus `world:check` green (4 files/29 tests).

- [x] Merge preview — e46f66a — one trivial conflict resolved, full root gate + world:check green post-merge.

## Product decision reversed: mobile unlocked

Developer explicitly reversed the guide's original "desktop + tablet only" decision ("Can you please unlock world for mobile"). Removed the viewport gate entirely rather than lowering its threshold, since the ask was to unlock mobile, not to admit slightly-narrower tablets: deleted `isViewportTooNarrow`/`MIN_VIEWPORT_WIDTH` from `auth.ts`, `checkViewport()` and its `resize` listener from `main.ts`, and `showViewportBlock`/`showMessage` from `ui.ts` (the latter had no other caller once `showViewportBlock` was gone, so it was dead code, not just the gate itself — removed per the same "delete completely if unused" rule this guide already follows elsewhere). Updated `world/tests/auth.test.ts` (27 tests now, -2) and struck the corresponding hard-prohibition line and DECIDED row in `docs/open-world-build-guide.md` §0/§1 so the guide doesn't contradict a decision the developer already made — future phases should treat "all viewport sizes" as the live product decision, not desktop/tablet-only.

**Flagged, not silently fixed**: `updateCamera`'s zoom only responds to a `wheel` event listener (`main.ts`), which mobile browsers never fire under normal touch input — there is currently no pinch/gesture zoom, so mobile users can pan (click-to-move already works via Pointer Events, which unify touch/mouse/pen) but cannot zoom at all. Left this as a known gap rather than adding multi-touch gesture handling unprompted — that's materially more scope than "remove the gate" and should be a separate ask if wanted. Phase 2's right-click-equivalent (long-press ≥500ms) was already speced as touch-generic, not tablet-specific, so no change needed there — it just wasn't built yet (Phase 2 hasn't started).

`world:check` green (4 test files / 27 tests). Only `world/` + this guide touched — no `src/`/`functions/`/`migrations/` changes, so `world:check` alone satisfies the commit gate.

- [x] Mobile unlocked — viewport gate and its dead-code dependents removed, guide updated to match, pinch-zoom gap flagged as a known follow-up (not fixed). `world:check` green.

## Merged `main` into this branch

Developer asked to pull `main` in ahead of opening a PR against it. Two commits on `main` not yet on this branch: `9a7bd14` (travel/teleport/activity-indicator changes — gameplay, no overlap with `world/`) and `b096418` (agent-skills restructure touching `CLAUDE.md`/adds `DESIGN.md`/`SKILLS.md`/`.claude/skills/`). Merged `origin/main` in — **zero conflicts**, including in `build_single.cjs` (main added one `sourceFiles` entry for the new `ActivityIndicator.js`; this branch's `pocketEnable3D`/`pocketWorldBetaEnabled` bake lines sit elsewhere in the file, so both merged cleanly).

Full root gate run given the breadth of files touched (`src/**`, `CLAUDE.md`, `build_single.cjs`, `tests/**`): `npm test` (172 files / 2242 tests), `npm run build`, `npm run rebuild` (confirmed both bake lines: `3D render: disabled`, `World beta button: disabled` — correct local defaults, unaffected by the merge), `npm run check:single` — all green.

- [x] Merge main — see commit introducing this entry — zero conflicts, full root gate green post-merge. Branch is now current with `main` and ready for a PR.

## Hero replacement, walking fixes, Phase 1 (mining → grant flush)

Developer decisions this session: stop using `public/3d-samples/hero.glb` in the world client (not fit for purpose), source assets from the new `assets/open-world/` library (~13k files, committed in #723), fix the buggy/animation-less walking, then proceed with Phase 1. Guide updated to match (§2.1 asset library section, STEP 0.10 superseded, STEP 1.1/1.5 real models, cow DT dropped — Farm Animal Pack is in the library).

**New hero**: KayKit Adventurers 2.0 Knight + Character Animations 1.1 Rig_Medium clips (both CC0), merged by new `world/scripts/build-hero.mjs` (gltf-transform: per-clip retarget by joint name → `idle`/`walk`/`mine`/`attack`/`die`, resample+dedup+prune, 2.3 MiB). Meshopt/quantize compression was tried and REJECTED — it splits the skin into 9 broken skins; keep the uncompressed write. New `world/scripts/inspect-glb.mjs` prints bounds/rig/clips of any GLB for future asset work.

**Walking fixes** (client `entities.ts` rework + new pure `motion.ts` w/ tests): waypoint queue consuming one diff-tile per 600 ms segment (440 ms catch-up when ≥1 queued, hard snap at ≥4 — hidden tab), smooth shortest-arc yaw toward movement (model faces +Z), walk/idle derived from actual traversal instead of raw server anim (no strobing on late diffs), `mine`/`attack`/`die` follow server anim, `die` plays LoopOnce+clamp.

**Phase 0 bug found during verification**: `scene.ts` ground texture drew tile z at canvas row `height-1-z`, but the rotated plane's UVs put canvas row 0 at world z=0 — every blocked tile rendered north-south mirrored, so clicks on visually-open grass hit the invisible real fence ("walking is buggy" report). Proven by projecting known tiles through the camera math; fixed to row `z` and re-verified with headless screenshots (fence now matches collision).

**Phase 1 (STEPs 1.1–1.5) implemented**: rocks live in DO memory with `depletedUntilTick`; `tick.ts` rewritten as a per-player state machine (`tickPlayer`: movement → interact-arrival → mining; pure, mutating, no I/O) + `mining.ts` (skills.json actions, 28-slot session inventory helpers, stackable-aware); level gate, pack-full, 8-tick depletion, auto-continue on respawn, in-session level-ups with message. Session stats seeded at hello via `loadCharacterWithSave` (`sessionStatsFromSave`). `grants.ts` implements the DECIDED flush algorithm (world_grants idempotency INSERT-or-ignore, 3× revision-conflict retry, clampXP + getLevelFromXP, `addItemToBank`, `auditLog('world_grant')`; injectable IO for tests). NOTE: guide step 4 (mirror /api/save summary update) needs no code — `writeSave` already refreshes total_level/combat_level. Flush triggers: chest deposit (items+xp), disconnect (items+xp), 100-tick timer (xp only); failed flushes merge back into pending tallies. Client: rock.glb (Kenney `rock_largeD`, tinted tin/copper) + chest.glb (KayKit dungeon), pickable statics raycast before ground, 4×7 inventory panel (items.json emoji), rising XP drops, 3-line message strip.

**Verified end-to-end** (wrangler dev + local D1): WS driver script ran hello → interact mine → auto-continue → deposit; D1 shows world_grants idempotency row, `world_grant` audit event, save blob +34 Mining XP + 2 Tin Ore in bank, total_level updated. Headless-Chromium screenshots confirm knight renders/walks/faces correctly, rocks/chest models, ore icons in the panel, reconnect-at-position. `dev-seed.mjs` gained DELETEs for world_grants/audit_events (migration 0028's FKs broke reseeding) — flagged, related, fixed in place.

`world:check` green (6 files / 50 tests). Only `world/` + `docs/` touched — no root gate required.

- [x] Hero + walking + STEP 1.1–1.5 — see commit introducing this entry — Phase 1 code complete; acceptance is the DEVELOPER TASK in the PR (real-browser script incl. PocketRPG-side bank/XP check).

## Hero reversed to Quaternius Ranger; inventory-first item flow

Developer reversed the hero choice ("Quaternius will have a better job rendering assets onto it") and reworked item semantics: the world pack must mirror the character's PocketRPG inventory (5 tin in + 5 mined = 10 back), and mined items must land in the inventory — the bank only on an explicit chest deposit.

**Hero**: `build-hero.mjs` now builds from Quaternius `Outfits/Male_Ranger.gltf` — the Universal Base Character body with the Modular Fantasy ranger outfit pre-fitted (hood/tunic/bracers/boots), 65-joint universal rig — plus UAL1 `Idle_Loop`/`Walk_Loop`/`Sword_Attack`/`Death01` and UAL2 `TreeChopping_Loop` (mine), retargeted by joint name as before. Two size traps fixed in the script: disposing an Animation does NOT dispose its channels/samplers (mergeDocuments dragged all 43 clips' accessors in — 40k orphans / 27 MB; dispose channels+samplers, prune src first), and the pack ships 4K PBR maps (66 MiB → strip normal/ORM/roughness, 1K webp base color via sharp devDep → 1.9 MiB). `HERO_SCALE` 0.85.

**Inventory-first flow**: `sessionInventoryFromSave` seeds the 28-slot pack + a `saveBacked` per-item tally at hello (welcome carries it; client icons come from items.json as before). `TickPlayer.minted` tracks world-created units. `GrantPayload` gains `itemsTo: 'inventory'|'bank'` + `moveToBank[]`: deposit banks the pack (save-backed units are MOVED inventory→bank, capped at what the save actually still holds — the main game may have consumed some; minted units grant straight to bank), disconnect grants minted units to the save inventory via `addItemToInventory` with bank spill-over on `INVENTORY_FULL` (mirrors the main game's auto-bank), timer stays XP-only. Seeded units are never re-granted.

**Verified end-to-end** (local wrangler + D1, seed now carries 5 tin ore): session A seeded 5 → mined 2 → pack showed 7 → disconnected undeposited → save.inventory = 7 tin, bank empty; session B seeded 7 → chest deposit → save.inventory empty, bank 7 tin; both world_grants payloads + audit rows correct. Zoomed headless screenshots confirm the ranger's outfit, facing, mine anim, and ore icons. `dev-seed.mjs` FK fix from last entry still holds.

`world:check` green (6 files / 56 tests). Only `world/` + `docs/` touched.

- [x] Quaternius hero + inventory-first flow — see commit introducing this entry — pushed to PR #727; DT-P1 acceptance script updated for inventory semantics.

## PHASE 2 — Cow combat, floor loot, OSRS click model (STEP 2.1–2.5)

Developer directed Phase 2 to begin ("build the cow & combat") — treated as greenlighting Phase 1 rather than waiting on the formal "PHASE 1 ACCEPTED" gate.

**STEP 2.1 — Input layer** (`client/src/picking.ts` pure + tested, `input.ts`, `ui.ts`): pick-priority (loot>npc>rock/object>ground), OSRS hover line, right-click / long-press-500ms context menu ("Choose Option" + a row per action per pickable near-to-far + Examine per object + Walk here + Cancel), npc name cyan, `(level-N)` green/red vs player combat level. Statics' `userData.pick` upgraded from a single-action `PickTarget` to the richer `Pickable` (actions[] with optional per-item `name`/`id` overrides — loot piles list `Take <Item>` per item). Examine strings live in `ui.ts`. **Interpretation recorded**: each object's Examine is grouped as the last row of its own action block (OSRS-authentic), not one global Examine before Walk here.

**STEP 2.2 — Cow** (`server/npc.ts` + `client/src/entities.ts` `createCowMesh` + `scripts/build-cow.mjs`): pasture_bull npc wanders 5–13 ticks/step inside its rect, respawns 25 ticks after death (removed from `ents` 3 ticks after death → die anim then gone), heals to full 17 ticks after an attacker leaves. `build-cow.mjs` renames the Farm Animal Pack cow's clips (Idle/Walk/Death → idle/walk/die), no retarget (own rig), no textures to strip → 174 KiB. **Two model gotchas fixed**: (1) the Farm pack authors the body length along the vertical axis unlike the character packs — the client rotates the model **−π/2 about X** to stand it on its feet before centring/scaling; (2) `THREE.Box3().setFromObject` is unreliable for skinned meshes (it ignored the node rotation, so the debug bbox lied) — the render, not the bbox, is the source of truth here. Cow centred on x/z + floored at y=0, scaled to 1.6-unit body length from its bounds; brown-box fallback.

**STEP 2.3 — Combat** (`server/combat.ts`, test-first `tests/combat-adapter.test.ts`): thin adapter around the REAL `createCombatState`/`processCombatTick` — no combat maths re-implemented. Fixed `'accurate'` stance, unarmed melee. **Guide correction**: STEP 2.3's "pass playerStats untransformed" is imprecise — the engine wants flat skill LEVELS (+ `currentHP`/`maxHP`/`hitpoints`), so the adapter flattens `{xp,level}` via `getLevelFromXP` exactly as `functions/_lib/mcp/bossFight.js` does. Session HP tracked on the player (seeded from hitpoints level, +1/100-tick regen); bull max hit 1 so death only at 1 HP → `{t:'dead'}` + respawn at zone spawn, no item loss. **New behaviour (worth keeping if Phase 2 is revisited)**: attacking a *wandering* monster needs re-pathing — a single path computed on interact lands on an empty tile once the bull steps away, so the npc-attack intent now persists and re-approaches via a `pathAdjacent` closure on the tick context until adjacent (the bull stops wandering once combat starts). XP flows through the SAME grant pipeline as mining (`grantSessionXp`).

**STEP 2.4 — Floor loot** (`server/loot.ts`): drops rolled by the engine (`state.loot` on death — the guide's `rollDrops` is already invoked internally), spawned as owner-only entities (100 ticks) → public (until 300) → despawn. Per-client visibility enforced by diffing each player's visible loot set tick-to-tick (naturally handles owner→public, pickup, despawn). **Inventory-first coupling**: `takeLoot()` adds to the pack AND increments `player.minted` together — a picked-up item that isn't minted evaporates on flush; a test drives real `flushGrants` to prove picked-up loot lands in the save inventory on disconnect.

**STEP 2.5 — Presentation**: DOM HP bar above a damaged bull (projected each frame), red/blue hitsplats from `{e:'hit'}`, hero `attack` clip driven by server `anim:'attack'`. **Deviation**: `toNpcDiff` always carries `hp/maxHp` (not combat-only as the guide says) so the client can hide the bar when a bull heals to full — a combat-only field would leave the bar stale.

**Verified end-to-end** (wrangler dev + local D1 + headless Chromium): WS driver drove hello → attack (server re-pathed to the wandering bull) → 3–4 hits killed it → loot (bones/raw_beef/cowhide) spawned → took each into the pack alongside the 5 seeded tin → walked back and deposited. D1 after: attack XP +32 (=8 dmg × 4, §5-exact), hitpoints +8, bank = tin×5 + bones + raw_beef + cowhide, inventory empty, one `world_grant` audit row. Screenshots confirm the cow renders as a spotted quadruped and stays upright while wandering, the context menu, and hover text. Combat-FX on-screen polish (hitsplat/HP-bar timing, the `Attack Pasture Bull (level-8)` coloured row) is code-complete + logic-unit-tested but left to the developer's DT-class B manual pass — a pixel-perfect click on a mid-wander target isn't reliable in automation. `dev-seed.mjs` now grants level-20 melee so the manual/e2e bull fight resolves in seconds.

`world:check` green (11 files / 89 tests). Only `world/` + `docs/` touched — no root gate required.

- [x] STEP 2.1–2.5 — see commit introducing this entry — Phase 2 code-complete + self-verified; acceptance is the DT-P2 manual script (real-device tap/long-press + combat-FX look/feel).

## Phase 2 mobile-test fixes (developer real-device feedback)

Developer tested on iOS and reported five issues; all fixed:

1. **Cow floating in the air** — the Farm-pack cow's skeleton already carries a baked −90°X + ×100 transform, so it renders upright with NO client rotation. The earlier client-side −π/2 rotation tipped it, and `THREE.Box3.setFromObject` is unreliable for skinned meshes (ignores the skinned pose), so the bbox-derived Y-floor lifted it off the ground. `createCowMesh` now uses the asset's known static bounds (`COW_BOUNDS`, from inspect-glb) to scale/centre/floor with no rotation and no runtime bbox. Verified: cow stands on the grass.
2. **Long-press opened the iOS "Copy / Find Selection" menu** instead of the game context menu — added global `-webkit-user-select:none` + `-webkit-touch-callout:none` + `touch-action:none` (index.html). Standard iOS fix; not observable in headless Chromium.
3. **Menu text had no spaces ("TakeCowhide")** — verb/name are rendered as separate coloured spans and the separating space collapsed. Fixed with `white-space: pre` on `.ctx-row`. Verified: "Attack Pasture Bull (level-8)" / "Take Cowhide" now render with spaces.
4. **Left-click loot should take the top item** — the spinning icon plane was a hard tap target, so taps fell through to the ground (Walk here). Added an invisible full-tile hit pad under each pile (opacity-0 material — `visible:false` is skipped by the raycaster) and spin only the icon so the pad stays put. Left-click default already resolves to `actions[0]` = the most-recently-dropped (top of the menu list).
5. **Unify item icons with the game** — replaced the emoji icons with the game's bespoke full-colour SVG art (`src/data/bespokeIcons.json`, all current world items covered). New `client/src/itemIcon.ts` lazy-loads the ~940 KiB icon data as its own chunk during world entry (initial bundle unchanged at 998 KiB). DOM inventory renders the SVG inline; loot markers rasterise the same SVG to their CanvasTexture. Verified: inventory shows the game's ore glyph, loot marker shows the bespoke drop art.

Combat→loot→deposit e2e re-run clean after the refactors (bank gets tin×5 + bones + raw_beef + cowhide, §5 XP). `world:check` green (11 files / 89 tests). Only `world/` + `docs/` touched.

- [x] Phase 2 mobile fixes — see commit introducing this entry — cow position, native-selection, menu spacing, loot tap target, unified SVG icons; verified via headless screenshots + WS/D1 e2e.

## Phase 3 — Other players, presence, local chat (STEP 3.0–3.4)

Built per the new guide §9 (authored this phase on developer instruction — master plan §7 "Phase 4 — Other players", scoped: shared hero model for every player, equipment-driven appearance deferred; players are ghosts, no pick target).

**STEP 3.0 — right-click walk bug (carried in from Phase 2 device feedback)**: `pointerup` ran the default action for every button, so a desktop right-click both opened the menu AND walked. Gated on `event.button === 0` (`input.ts`). Verified in-browser with a WS observer: right-click produced zero movement diffs (menu open), left-click still walks.

**STEP 3.1 — presence protocol** (`server/WorldZone.ts`): welcome's intro diff now lists every other player's ent (never self); joins queue into the next tick's ents; leaves broadcast via the existing `removed` field, suppressed if the player is still present (same-tick rejoin). Player diffs stay hp-free (other players' HP is private). **Two hardenings surfaced by e2e**: (1) `onClose` now ignores a stale socket whose charId was re-registered on a new connection — a late duplicate-kick close must not tear down the live player; (2) `onClose` is async and awaits the disconnect grant-flush + position checkpoint — they were fire-and-forget, and the write can be lost when the last player leaves and the DO idles out (observed: a walked position silently not persisting; checkpoint round-trip now passes repeatedly).

**STEP 3.2 — client rendering** (`client/src/main.ts`, `ui.ts`): `others` map mirrors the npc pattern (async hero-mesh clone with pending-diff buffering; template cached so N players = 1 GLB fetch), DOM name plates projected per frame, `removed` routes to the right map, no `userData.pick` (rays pass through to loot/npcs/ground). Other players also get hitsplats via the zone-wide hit events.

**STEP 3.3 — local chat** (`shared/chat.ts` + protocol + `ui.ts`): client `{t:'chat',text}` → server sanitises (`sanitizeChat`: strip control chars, trim, cap 120; unit-tested) → zone event `{e:'chat',charId,name,text}`. Existing per-connection rate limiter covers flooding. Client: input pinned under the message log (`user-select:text` override on the input — the global mobile-fix `user-select:none` would break the caret), chat renders as `Name: text` in the log + overhead yellow text above the speaker (self included) for 4 s. All player text rendered via `textContent` only. `dev-seed.mjs` now seeds a second character (WorldFriend, id 2) and prints both handoffs for two-device testing.

**Verified end-to-end** (wrangler dev + two WS clients + two headless Chromium pages): B's intro lists A (name WorldTester); A receives B's join ent (WorldFriend) within a tick; B streams A's walk diffs; a chat sent with surrounding junk arrives sanitised with the right name; A's disconnect broadcasts `removed:["1"]` — 5/5 PASS, re-run clean after the onClose hardening. Two-page screenshots show both heroes in one frame with the WorldFriend name plate and `WorldFriend: Hello WorldTester!` in the log; overhead text verified via DOM position/text on both pages (the 4 s TTL kept expiring before swiftshader finished screenshotting). Right-click regression PASS.

`world:check` green (12 files / 97 tests). Only `world/` + `docs/` touched — no root gate required.

- [x] STEP 3.0–3.4 — see commit introducing this entry — Phase 3 code-complete + self-verified; acceptance is the DT-P3 two-device manual script (guide §9 STEP 3.4).

## PHASE 4 — Shared-kill loot attribution + pack reordering (STEP 4.1–4.4)

Developer confirmed the Phase 4+ roadmap decisions (recorded in `docs/open-world-next-phases-scope.md`; asset tracking in `docs/open-world-asset-coverage.md`) and greenlit the build. Guide §10 rewritten from "do not build" into the Phase 4 spec.

**STEP 4.1 — damage attribution + shared HP** (`npc.ts`, `combat.ts`): `NpcState.damageByChar` (per-attacker total + last-increase tick), `recordDamage`/`topDamageContributor` pure + unit-tested (tie → whoever reached the total first). Each attacker's engine session syncs `state.monster.currentHP` from the shared npc record before its tick — players tick sequentially, so concurrent damage serializes and the existing dead-npc guard stops a same-tick double-kill. `killNpc` spawns loot with `ownerCharId = topDamageContributor ?? killer`, then clears the map; out-of-combat full heal also clears it.

**STEP 4.2 — single retaliation target**: `npc.attackerId` is now claim-if-null (was unconditionally overwritten each tick by every attacker — with two attackers the bull would have hit both every swing). Only the target's session applies monster-sourced events; others discard them. Release on walk-away/kill/disconnect already existed; **player death now releases it too** (was a pre-existing latent leak: a dead target left `attackerId` pointing at a respawned-away player, pinning the npc in combat forever; only reachable at 1 HP vs the bull, so masked until now). A surviving attacker claims the vacancy next tick.

**STEP 4.3 — pack reordering**: protocol `{t:'moveInv', from, to}` (integers in [0,28) or close 1008); pure `moveInventorySlot` in `mining.ts` (swap/relocate, same semantics as the main game's `InventoryGrid`); `WorldZone` queues an `{e:'inv'}` echo for the next tick (one-diff-per-client-per-tick preserved). Client: pointer-drag with 6px threshold + ghost + target highlight on `#inv-panel` (desktop and touch share the path), optimistic local swap, server echo authoritative. Flushes read minted/saveBacked tallies, so slot order is provably cosmetic — pinned by a test.

**Verified end-to-end** (wrangler dev + two WS clients): identical shared HP trajectory on both clients (8→4→2→0), all player-targeted hitsplats at exactly one charId, loot visible to only the top-damage client during the owner window, moveInv echo round-trip (slot 0 → 27), out-of-range moveInv closed 1008. Environment note for future sessions: `curl` probes of localhost must use `--noproxy '*'` here (the sandbox proxy blackholes localhost otherwise), and wrangler picks the next free port (8788) if a stale workerd holds 8787.

`world:check` green (13 files / 109 tests). Only `world/` + `docs/` touched — no root gate required.

- [x] STEP 4.1–4.4 — see commit introducing this entry — Phase 4 code-complete + self-verified; acceptance is the DT-P4 two-device manual script (guide §10 STEP 4.4).

## PHASE 5 — Equipment visuals v1: weapons in hand (STEP 5.1–5.5)

Developer greenlit Phase 5 immediately after Phase 4 (will test both together). Guide §11 spec written, then built in the same session.

**STEP 5.1 — models**: `scripts/build-weapons.mjs` → 10 archetype GLBs (22–101 KiB) in `client/public/models/weapons/`. Nine from KayKit Adventurers glTF (grips at origin, blade +Y — confirmed via inspect-glb before writing any attach code); `blunt` from Quaternius Hammer_Double OBJ via `obj2gltf` (`--no-save` install; script exits non-zero with instructions if it's missing). KayKit-over-Quaternius for held props is an accepted vendor-steering deviation: held weapons only parent to a joint (no rig sharing), and Quaternius RPG Items ships OBJ/FBX, not glTF.

**STEP 5.2 — registry**: `shared/appearance.ts` maps all 139 weapon items by ordered token rules + `twoHanded` upgrade + tier-prefix tints. Pattern-order traps (crossbow/bow, battleaxe/axe, godsword/sword, boneclaw_rapier NOT matching /claws/) pinned in `tests/appearance.test.ts`. Tools (fishing rod/net/spade) deliberately unmapped → bare hands.

**STEP 5.3 — protocol/server**: `GearDescriptor` on `EntityDiff.gear` + `welcome.you.gear`; computed once at hello, fixed per session. One typecheck fix: items.json has `slot: null` entries so the registry's Items type needed `string | null`.

**STEP 5.4 — client**: `applyWeapon` in `entities.ts` (template-cached, tinted clone under `hand_r`, idempotent per archetype+tint key, post-await race re-check, silent bare-hands on failure). **Grip tuning method worth reusing**: a standalone probe page (three.js import-map + file server over `node_modules`) rendered 8 candidate rotations side-by-side in ONE screenshot — picked `[-π/2, 0, π/2]` (blade upright in palm) in a single iteration instead of rebuild-per-guess. Staff/wand then flipped to a planted-vertical pole look (`[π, 0, 0]`) after the in-game shot showed a horizontal staff reading wrong. Bow/crossbow overrides are by-analogy, untested visually (no seeded character equips one) — flagged for the DT-P5 eyeball.

**Gotcha rediscovered**: `wrangler dev` serves the BUILT `client/dist` — a stale build silently shows old client code; rebuild before any visual verification. Also: piping a background `npm run dev` through `head` kills the server when head exits.

**Verified**: dev-seed now equips char 1 with `runeforged_scimitar`, char 2 with `magic_staff` (distinct saves per character — previously shared one blob). Screenshots: tinted sword held upright in-hand; staff planted vertical, orb up. Two-client WS e2e 4/4: both welcomes carry own gear; B sees A's sword archetype+tint in ent diffs; A sees B's staff.

`world:check` green (14 files / 115 tests). Only `world/` + `docs/` touched — no root gate required.

- [x] STEP 5.1–5.5 — see commit introducing this entry — Phase 5 code-complete + self-verified; acceptance is the combined DT-P4+P5 manual script (guide §10 STEP 4.4 + §11 STEP 5.5).

## Phase 5 grip fixes (developer device feedback)

Developer's zoomed screenshot showed the sword clipping through the character, and daggers/axes/wands "not appearing". Root cause was one mistake with two symptoms: the grip was tuned against the **T-pose**, but when the idle pose drops the arm the palm rotates ~90°, so blades pointed across the body — long weapons clipped through the legs, and short ones (dagger, axe head, wand) sat entirely INSIDE the mesh, i.e. they were attaching fine and just invisible.

Fixes:
1. **Idle-pose grip retune.** The probe page now plays the actual `idle` clip before rendering and labels every candidate (the unlabeled first pass mis-identified which candidate looked right — labels are not optional). New default `[-π/2, π/2, π/2]`: blade vertical at the side, tip down, clear of the body. Verified across ALL ten archetypes in one labeled render: dagger/axe/wand clearly visible, bow vertical at the side (`[π/2,0,0]`), crossbow carried level (`[0,0,0]`), staff keeps its planted grip, blunt gets a per-archetype 0.5 scale (the Quaternius hammer is oversized). Wand no longer has an override (default carry reads right).
2. **Scimitars → curved-blade asset** (developer decision): `scimitar` moved from the sword rule to the dagger rule in `shared/appearance.ts`, so every scimitar tier shares the KayKit curved blade with its tier tint — same asset dragon_claws resolves to (pinned by a test comparing the two).

In-game screenshots re-verified: runeforged scimitar (curved model, teal tint) held at the side without clipping; staff unchanged. `world:check` green (14 files / 116 tests). Only `world/` + `docs/` touched.

- [x] Phase 5 grip fixes — see commit introducing this entry — idle-pose grips for all archetypes, scimitar asset swap; DT-P5 manual pass still owns final look/feel sign-off.

## Multiplayer connectivity fixes (developer device feedback: misplacement, lag, invisible players)

Developer videos showed: characters misplaced after play, 1–2s observer delay bursts, taps doing nothing, and a joining player invisible until refresh. All four trace to one unhandled reality: **mobile sockets die and reconnect constantly**, and neither side handled it.

Root causes found in review:
1. **Client rebuilt the whole scene on every reconnect.** partysocket silently reconnects and re-fires `open`; the client re-sent `hello` (correct) but the welcome handler unconditionally re-ran the full scene build — second canvas, second render loop, duplicated listeners. Everything after the first silent reconnect was undefined behaviour until a hard refresh (the "invisible second player").
2. **Server discarded the live session on duplicate connection.** The old kick path deleted the in-memory player and re-seeded from D1: position from a checkpoint up to 60s stale (the misplacement), and **unflushed minted items/pending XP silently lost** (the old socket's `onClose` early-returns for a stale conn, so no disconnect flush ever ran).
3. **No heartbeat, no dead-socket detection.** iOS/mobile networks kill idle WebSockets without a close frame; partysocket only notices on TCP timeout. Meanwhile taps were buffered into the dead socket and burst on reconnect (the "click does nothing" + "1–2s delay" spikes).

Fixes (all verified e2e):
- **Server session carry-over** (`WorldZone.handleHello`): a hello for an already-live character swaps the connection onto the existing in-memory player (intents/combat cleared, aggro released), kicks the old socket, and replays welcome+intro from LIVE state via a new shared `sendWelcome()`. No D1 reads, no grant loss, no teleport. Fresh joins unchanged.
- **Client resync** (`main.ts`): repeat welcome → `resyncFromWelcome` (snap self, replace pack/stats, drop all npcs/others/loot/rock state and let the intro diff repopulate) — never rebuilds the scene. `ensureNpc`'s load promise gained the same abort guard `ensureOther` already had.
- **Heartbeat + watchdog**: authed ping every 10s (keeps NATs alive); force `socket.reconnect()` when nothing has been heard for 20s while visible, and on `visibilitychange` resume after >5s silence (the phone-lock case). A standalone "Reconnecting…" banner shows between close and re-welcome so buffered input is no longer a mystery.
- **Presence keyframe** (server, every 50 ticks): all player ents re-broadcast even when idle, so any client that missed a join edge self-heals ≤30s.

**Verified**: WS driver e2e 7/7 — reconnect welcome resumes the exact live tile (not spawn/checkpoint) with the mined ore still in the pack, old socket closed 1008/duplicate_connection, observer never sees a leave, keyframes flow, post-reconnect input reaches the observer. Browser e2e: duplicate-kick the page's socket → partysocket reconnects → ONE canvas, zero page errors, banner cleared, hero at the live position.

**Scalability review notes** (asked for; no code churn): per-tick cost is O(players × loot) with zero per-tick durable writes — sound at zone scale (the §6 cost model holds). Baseline observer latency of ~1.2s is inherent to the design (600ms server tick + 600ms client playback per tile, the OSRS model) — the *spikes* were the dead-socket buffering above, now bounded by the watchdog. Deferred as micro-optimisations: pre-serialising the shared ents array once per tick instead of per player, and per-player interest filtering (only relevant once zones hold many players).

`world:check` green (14 files / 116 tests). Only `world/` + `docs/` touched.

- [x] Connectivity fixes — see commit introducing this entry — reconnect carry-over + client resync + heartbeat/watchdog + presence keyframe, all e2e-verified; DT: redeploy preview and re-test on devices.

## Connection stability: stop kicking legitimate players (developer feedback: "reconnecting every couple of seconds")

The reconnect banner exposed how often the server was CLOSING connections on healthy WiFi. Review found three server/client behaviours that punished normal play:

1. **The rate limiter kicked at >10 msg/s — but OSRS-style tap-to-move easily exceeds that.** Every burst of eager tapping closed the socket (this was also the likely original source of the pre-carry-over "misplaced character" reports — each silent kick teleported the player to a stale checkpoint). Now: pings bypass the limiter entirely (they're the keepalive — dropping them starves the watchdog), messages above a **15/s soft limit are silently dropped** (a dropped walk is harmless; the next tap replaces it), and only a **>40/s hard flood** (buggy/abusive client) closes the connection — and even then the carry-over path makes the reconnect lossless.
2. **The 5s auth timeout ran while `handleHello` did its D1 work** — a cold-start hello could be kicked mid-handshake (`auth_timeout` → reconnect loop). The timer now clears the moment hello arrives; auth failures still close explicitly.
3. **The visibility-resume check reconnected after 5s of silence while pings only flow every 10s** — a quick app switch on a healthy connection forced a needless reconnect. Threshold raised to 15s (above the ping cadence). Client also collapses rapid same-tile taps (<400ms) into one walk message.

**Verified e2e**: 25 taps/s → no disconnect; ping answered mid-flood; 60-message burst → 1008/rate_limited kick and the reconnect still resumes the live session; 45s idle soak with heartbeat only → zero closes, pongs flowing. `world:check` green (14 files / 116 tests). Only `world/` + `docs/` touched.

- [x] Connection stability — see commit introducing this entry — soft-drop rate limiting, hello-time auth-timer clear, saner watchdog thresholds, tap dedupe; flood + soak e2e green. DT: redeploy preview, re-test two devices.

## Phase 5.5 — pathing fix, pack item actions, real banking (developer feedback bundle)

Three requests: fix zig-zag pathing, make the chest open a real bank (not deposit-all), and give the pack main-game left-click/right-click actions incl. Drop.

**Pathing root cause**: BFS with uniform step cost treats a 10-tile diagonal arc as "equal" to the straight line (same step count), and the neighbour ordering made it pick the arc — a straight 26-tile walk visibly bulged 10 tiles north. Replaced with A\*: steps remain the primary cost (tick model unchanged — same arrival times), a tiny per-diagonal epsilon breaks ties toward the straightest route, pinning paths inside the start→destination rectangle. Shape regression tests added (straight line stays on its row; bounding box; minimal diagonal count).

**Pack actions**: `{t:'invAction'}` with shared client/server verb derivation (`world/shared/itemActions.ts` — driven by items.json/skills.json, no hand-authored tables): Wield/Wear (real `src/engine/equipment.js` equip incl. 2H/shield rules + requirements), Eat (heals, new HP pill + `{e:'hp'}` events), Bury (skills.json prayer XP), Drink (deferred with a message — potion boosts need decay infra), Drop (floor loot at the player's tile, owner-only ~10s / 17 ticks, then public, 3min despawn). Equip re-gears the 3D weapon live for everyone (`gear` now rides every player diff so unequips propagate; the killed client-side bug: slot presses landing on the icon's SVG were ignored — `indexOfCell` required HTMLElement).

**Banking**: chest → walk adjacent → bank modal (bank + pack grids); tap moves 1, hold/right-click offers 1/5/10/X/All; server clamps everything and requires adjacency per op. Bank view seeds from the save at hello (charge-carrying entries excluded — charges can't survive the session model).

**Accounting**: new provenance pools (`sessionItems.ts`): minted / saveBacked / bankSourced + consumed/deposited tallies; flush payload extended (removeFromInventory, removeFromBank, mintedToBank, bankToInventory, equipment snapshot), all clamped against the live save; debounced 3s durability flush after bank/equip/consume. Unit-tested invariant: pack count = minted + saveBacked + bankSourced.

**Verified**: 24/24 WS e2e checks (straight-line walk rows, eat/bury/equip incl. observer seeing the re-gear, mismatched-action rejection, drop hidden from the observer at 4s and public by ~10s, bank open/withdraw/deposit with clamps, away-from-chest ops ignored, and a disconnect flush audited in real D1: equipment snapshot, eaten save-backed + bank-sourced units removed from the right stores, withdrawals returned, deposits banked, drops gone). 12/12 headless UI checks (HP pill, chest hover→modal, tap-withdraw, 1/5/10/X/All menu, X prompt, item menu Eat/Drop, tap-to-eat). `world:check` green (16 files / 133 tests).

- [x] Phase 5.5 — see commit introducing this entry — pathing A\*, invActions, bank UI, provenance pools; DT: on-device pass (pathing feel, bank modal on mobile, long-press menus, drop visibility between two devices).

## Phase 6 — zones, transitions, The Whisperwood, Woodcutting, three monsters (guide §13)

The world grows a second zone. Infrastructure first, then content:

**Zone registry + transitions**: `ZONES` registers every `world/zones/*.json`; unknown DO room names are refused (previously any room silently became a second pasture). Zone JSON gained `exits`, `props`, `palette`, and `tree` objects; `validateExitGraph` (vitest, over the real files) checks cross-zone arrival tiles — walkable, and never on an exit tile (no ping-pong). Standing on an exit tile (even mid-path) transitions: the server awaits a `'transition'`-reason flush (drains pools exactly like disconnect — the pack re-seeds from the save in the next zone), awaits the `world_positions` checkpoint written with the TARGET zone/tile, then sends `{t:'transition'}` and closes. The client stores the target zone and reloads — a clean scene/renderer beats leak-prone in-place teardown; `/api/world/session` now returns the character's current zone so fresh devices land right. Exits render as pulsing gold pads ("Go-to the Whisperwood"); clicking one is client-side sugar for walking to its tile.

**Gather generalisation**: trees are a mining reskin, as scoped — `RockState` gained `skill`, `GATHER_SKILLS` maps skill → real `skills.json` actions + verb ('mine'/'chop', validated server-side against the node), one state machine drives both. Woodcutting XP/products/levels all come from `skills.json → woodcutting.actions` (normal 25xp/logs, oak level 15/37xp). Depleted trees swap to a stump model; respawn reuses the 8-tick window and the `diff.rocks` wire field.

**The Whisperwood** (`forest.json`, 48×48, generated by a deterministic seeded script, 75% walkable): darker ground palette, ~250 Kenney nature-kit props (pines on the `#` tree-line borders and thickets, bushes/mushrooms/flowers/moss-boulders scattered), 6 normal trees + 3 oaks, a bank chest by the west entrance, exits west↔pasture-east. Monsters (all passive, D5): 2× field_chicken, 2× cave_goblin, 1× arcane_adept — the combat adapter needed zero changes. Models from the Quaternius Ultimate Monsters Bundle via the new generic `scripts/build-monster.mjs` (clip-rename; the goleling is a flyer — `Flying_Idle`/`Fast_Flying` — and hovers); client `createMonsterMesh` registry with baked bounds; box placeholder stays the fallback. Props/trees/stump built by `scripts/build-props.mjs` (CC0 Kenney, prune-only).

**Verified**: 27/27 WS e2e — pasture welcome carries the exit; mine tin → walk onto the exit → transition(forest,2,24) + server-closed socket + `world_positions` flipped BEFORE the client reconnects; forest welcome (name/palette/props/9 tree statics/arrival tile, mined tin still in pack); chop → 25xp + logs + depletion; oak gated at level 1; chicken dies + drops + combat XP; return transition; pasture at (29,8) with logs intact; save blob absorbed both transition flushes (woodcutting 25xp, mining 17xp, logs + 6 tin in inventory) with audited grants. Headless screenshots: forest palette/props/trees, chop → stump + "+25 Woodcutting", chicken/goblin/wizard models, both exit pads, bank chest. `world:check` green (143 tests). Only `world/` + `docs/` touched.

- [x] Phase 6 — see commit introducing this entry — zone registry/transitions, prop layer, The Whisperwood + Woodcutting + chicken/goblin/wizard; DT: bundled DT-P4→P6 manual pass (see guide §13 STEP 6.6).

## HUD feature batch — linger, invisible-self fix, running, minimap, tabbed panel (developer request 2026-07-12)

Five developer requests, all built together (they interleave in `main.ts`/`ui.ts`). Guide §0 rule 4 + §1 Movement row updated (several original freezes were already lifted; running/minimap/HUD panel now added).

1. **Disconnect linger (feature 1 — "don't log me out of world for others in ~10s of tab-away")**: backgrounding a tab drops the socket in ~10s and the old `onClose` removed the player + broadcast the leave immediately. Now `onClose` marks a **linger** (`lingerUntilTick = tickCount + LINGER_TICKS`, ~60s): the player stays in-world (visible to others, frozen/idle, combat + aggro released, run off) with a closed-socket-tolerant `send()`; a reconnect (`handleHello` carry-over) clears the linger; the tick loop expires it via a new `removeAndFlush()` (the old immediate-removal path, reused by explicit logout too). Lingering players are skipped as diff recipients but still ride `ents` to others.

2. **Invisible-self on return (feature 2)**: skinned characters animate outside their bind-pose bounds, so three.js frustum-culled the hero after a background/resume snapped it to a new tile — most visibly the player vanishing to themselves. Fixed with `frustumCulled = false` on all cloned character meshes (hero/cow/monster), `self.mesh.visible = true` on every resync, and a `webglcontextlost` preventDefault so three.js auto-restores GPU resources on a mobile context drop.

3. **Running (feature 3 — toggle + run energy, OSRS-style, developer choice)**: `{t:'setRun'}` toggles `player.running`; `tickPlayer` takes 2 path steps/tick while running with energy, draining `RUN_DRAIN_PER_TILE` (0.6) per tile and regenerating `RUN_REGEN_PER_TICK` (0.45) on any walk/idle tick, capped 0-100; `{e:'run', energy, running}` echoes on change. Client run orb (🏃 %) toggles it; welcome/resync seed it.

4. **Minimap (feature 4)**: new `client/src/minimap.ts` — a 132px top-right canvas baking the zone collision once and blitting live dots each frame (throttled 150ms): player gold, npcs red, other players white, exits cyan.

5. **Tabbed HUD panel (feature 5)**: the right-side inventory became `#hud-panel` with a top tab bar (Inventory / Equipment / Combat / Logout, all ≥44px), using the game's OWN bespoke nav icons (not emoji) — `backpack`/`paperdoll`/`combat_level` from `bespokeIcons.json`, the `door` glyph from `gameIcons.json` (logout), and the bespoke `sprint` icon on the run orb; painted by `paintHudIcons()` once the icon data lazy-loads (`itemIcon.ts` gained `uiIconMarkup(key,size,color)` + a lazy `gameIcons.json` load). Equipment tab = paperdoll of worn items with tap-to-unequip (`{t:'unequip'}`, reverse of the real engine equip, mints the returned unit). Combat tab = Accurate/Aggressive/Defensive stance buttons (`{t:'setStance'}`, applied to new fights and live mid-fight) + a working special-attack bar/button (`{t:'special'}` sets `specialAttackQueued` on the real engine state; `stepCombat` handles `specialHit` events + mirrors `specialAttackEnergy` via `{e:'spec'}`). Logout (`{t:'logout'}`) = immediate `removeAndFlush` server-side + client reload with the session cleared (avoids partysocket's auto-reconnect re-entering the world). New welcome `you` fields: runEnergy/running/stance/specialEnergy/equipment; new events run/spec/equip.

**Verified**: `world:check` green (typecheck + 181 tests [+7 new in `world-hud.test.ts`: run 2-tiles/drain/regen/cap/echo, stance-into-fight, special queue→drain] + client build). WS e2e driver 14/14 against live `wrangler dev` + local D1: welcome payload shape, special-out-of-combat message, run toggle echo, running moves 2 tiles/tick + drains, **linger (a closed char2 does NOT leave for others within 3s)**, logout removes promptly. Headless Chromium screenshots: minimap (zone + player/npc/exit dots), tab bar, run orb, Inventory grid, Combat tab (stances + Special 100% bar + button), Equipment tab (11 slots). Only `world/` + `docs/` touched — no root gate required.

- [x] HUD feature batch — see commit introducing this entry — linger/visibility/running/minimap/tabbed-panel; DT: on-device pass (tab-away ≤1min stays online for others, background-return visibility, run drain/regen feel, stance + special in a real fight, unequip, logout).

## Phase 7 — Lumbright town hub, Smithing + Cooking (guide §14, authored + built this session)

Developer instruction "continue" after the merged HUD batch → next roadmap phase per D6. Guide §14 authored first (replacing the "After Phase 6" stop marker), then built.

**Crafting engine** (`shared/recipes.ts` + `server/crafting.ts` + `tick.ts`): station→recipe tables derived ENTIRELY from `skills.json` (furnace = `smelt_*` smithing actions, anvil = the rest, range = cooking); `{t:'craft', station, recipeId, qty}` re-validates adjacency/recipe/level/materials server-side and clamps qty to `maxCraftable`; a per-tick crafting state machine mirrors mining (anim `'mine'`, `action.ticks` per completion, multi-input `removeItems`, product minted, XP via `grantSessionXp`, stops on exhaustion/pack-full/movement). **Cooking burn is the REAL engine roll** — `checkBurn` from `src/engine/skilling.js`, burnt → `burnt_food` + 1 XP (exact `SkillingScreen.jsx` semantics). Pack-full safety: materials are removed first and rolled back from a snapshot if the product doesn't fit (a stackable-material pack can free no slot). Pool accounting rides `TickResult.crafted` → `consumeUnits` in the DO (tick.ts has no pools access) + a debounced durability flush.

**Client**: `crafting.ts` recipe panel (bank-modal mould; opens on the new `{e:'station'}` arrival event, per-recipe icon/level/have-need material chips/Make 1-5-All, re-renders on inv + xp events, closes on walk-away); `main.ts` now tracks session stats (welcome + xp events, `getLevelFromXP`) for the panel's level gates. `statics.ts` renders the three stations as pickables (Smelt/Smith/Cook + Examine).

**Station assets — library gap found**: NO anvil/furnace/range model exists anywhere in `assets/open-world/`. Furnace = MegaKit `Prop_Chimney2` ([Standard] → stripped/512px webp, 21 KiB, `build-stations.mjs`); range = Kenney `campfire_bricks` + an emissive flame cone added client-side; anvil = primitives composed in `statics.ts` (reads clearly in screenshots). Bespoke models raised as a DEVELOPER TASK (DT-C download or Tripo generation — developer's call).

**Lumbright** (`gen-lumbright.mjs` → `zones/lumbright.json`, 64×64, 92.4% walkable, 271 props): walled town (Kenney castle-kit wall/tower pieces — the wall model is directional, horizontal runs rotate 90°, caught by screenshot), east + south gates, market square (KayKit Medieval Builder market stalls/well + Kenney lanterns/cart), houses/mill/lumbermill as whole-building props on blocked footprints, bank chest, smithy (furnace+anvil), kitchen (range). Exits: east ↔ pasture west (0,8) — new pasture exit; south ↔ forest north — the forest tree-line got a 2-tile carve at x=10-11 (one pine prop removed with it). Monsters outside the walls (passive, D5): bogling_sprite (Green Blob), frostbite_imp (Blue Demon), marshfen_toad (Frog) via `build-monster.mjs` + registry + examine strings; coverage doc updated. Editor: catalog/placement/grid/stamps all accept the three new object types.

**Verified end-to-end**: 196 vitest (14 new crafting tests incl. burn-at-level via stubbed RNG, rollback-on-full, tie to real skills.json rows); WS e2e 13/13 against live wrangler + local D1 — pasture→Lumbright transition at (62,31), pack survives the flush, furnace panel opens on arrival, smelt bronze clamps to the scarce ore (3 bars, copper exhausted), anvil dagger from 1 bar, range genuinely burnt the level-1 beef (+1 xp), bogling kill + loot take, east exit back to pasture (1,8), reconnect resumes with crafted goods. D1 after: smithing 30 xp / cooking 1 xp in the save, inventory holds bars+dagger+burnt food+loot, 4 audited grant flushes, `world_positions` flipped per leg. Headless screenshots: market square, furnace recipe panel (have/need chips + level gates), smithy corner, corrected walls + a monster outside. **E2E-driver gotcha for future sessions**: one diff carries several events — a waiter that consumes the whole message eats the events a later waiter needs; log events separately.

`world:check` green (20 files / 196 tests). Only `world/` + `docs/` touched — no root gate required.

- [x] Phase 7 — see commit introducing this entry — guide §14 authored + STEPs 7.1–7.6 built and self-verified; acceptance is the DT-P7 manual script (guide §14 STEP 7.6) + the open station-model DT.

## Minimap click-to-walk + magic spell selection (developer requests 2026-07-12)

Three requests; one withdrawn (bank scrolling already works on mobile — reported change reverted, zero diff).

**Minimap click-to-walk**: `createMinimap` gained an `onClickTile` callback — pixel→tile via the inverse of the dot projection, blocked tiles and out-of-map clicks ignored; `main.ts` routes it through the same `walkTo` the ground click uses (modal close + click marker + tap dedupe). A far click walks as far as the server's 64-tile path cap allows.

**Magic weapons cast real magic now** (was: a staff fought with melee math). `startCombat` resolves the fight through the REAL `resolveMagicSpell`/`getCombatType` (`src/engine/equipment.js`): magic weapon + selected spell → `createCombatState(..., 'magic', stance, spell)`; powered staffs use the engine's own no-spell path; a magic weapon with NO castable spell refuses the fight ("You need to select a spell…") — the engine would splash 0s forever. `stepCombat` now passes the session pack as the engine's inventory (rune checks) and applies the live-game rune contract: consume `state.runesConsumed` on a landed hit, clear it, drain provenance pools (`TickResult.crafted` generalised to `consumed`), inv echo + debounced flush; `noRunesForSpell` → message + fight ends. `{t:'setSpell', spell|null}` is level-gated server-side against session Magic and applies mid-fight (clearing the spell mid-magic-fight stops the fight). Ranged weapons stay on the melee path — ranged combat remains out of scope.

**Spell picker UI (developer decision: REPLACES the stances)**: with a magic weapon equipped the Combat tab swaps Accurate/Aggressive/Defensive for a `Spell: <name>` button; tapping it opens a context menu of castable spells (level-gated client-side from session stats, re-validated server-side) + "No spell". Bare fists/melee restore the stances. Seed chars: runes added so char 2's staff can cast.

**Verified**: `world:check` green (199 tests — +3 magic combat-flow tests: real-magic kill with per-cast rune consumption, out-of-runes stop, spell-less refusal). WS e2e 4/4 (char 2: spell-less attack refused, `fire_strike` level-gated at Magic 1, wind-strike bull kill +46 Magic xp with 1:1 rune drain). Playwright 5/5: minimap 40%,40% click → walk (12,12); melee shows stances/hides button; staff hides stances/shows button; picker lists Wind Strike; selection sends `{t:'setSpell'}` + relabels. **Env gotcha recorded**: `.dev.vars` must be written to `world/.dev.vars` — a shell whose cwd silently reset to repo root wrote it there and every hello failed signature verification.

- [x] Minimap walk + magic spells — see commit introducing this entry — DT: on-device pass (minimap tap accuracy, spell picker on mobile, a real staff fight incl. running out of runes).

## TERRAIN TRACK — `docs/open-world-terrain-plan.md`

Separate from the build-guide steps above: the phased move from the flat checker
ground to authored 3D terrain. Client-render-only; server stays flat/tile.

### TERRAIN T0 — height seam (no visual change)
Added the single integration seam so terrain height can later lift every placed
mesh with no further call-site changes:
- `scene.ts`: module-level `heightSampler` + `setHeightSampler`/`groundHeight`;
  `tileToWorld` now returns `groundHeight(x+0.5, z+0.5)` as Y (0 when unset).
- `terrain.ts` (new): `createHeightField(width, height, corners)` — bilinear
  sampler over a `(w+1)×(h+1)` corner grid; registers itself as the active
  sampler. Production passes `corners = null` (flat) this phase.
- `main.ts`: registers the (flat) height field before ground/props/statics/
  entities are placed. `input.ts`: click marker rides `groundHeight`.
- `world/tests/terrain.test.ts`: corner exactness, bilinear midpoints, edge
  clamping (no NaN), and the tileToWorld seam (flat when unset, lifted when set).

Because the sampler is flat this phase, the game is pixel-identical; the seam is
proven by tests and ready for T1 to fill the grid.

**Verified**: `world:check` green — typecheck clean, 205 tests pass (+6 terrain),
vite build succeeds.

- [x] TERRAIN T0 — height seam landed; flat sampler, pixel-identical, tests green.

### TERRAIN T1 — displaced terrain mesh (procedural source)
Zones can now carry a `terrain` block; the ground becomes a displaced, lit mesh
and every placed thing rides it via the T0 sampler.
- `shared/zone.ts` + `shared/protocol.ts`: `ZoneTerrain` type (`relief`,
  `procedural{seed,frequency}`, `heightmap?`, `material?`); `validateZone`
  bounds relief 0..1.5 and the procedural params; welcome payload forwards it;
  `server/WorldZone.ts` includes it when present.
- `client/src/terrain.ts`: deterministic seeded value-noise fBm
  (`proceduralCorners`) → corner grid; `createTerrain` registers the sampler and
  builds the mesh. `scene.createGround` gains an optional `corners` arg —
  subdivided one segment/tile, vertices lifted to corner heights,
  `computeVertexNormals` for lighting. Editor preview stays flat (no corners).
- `main.ts` uses `createTerrain` (returns the ground mesh picking raycasts).
- `zones/pasture.json`: reference `terrain` block (seed 1337, relief 0.8).
- Tests: procedural determinism (same seed identical, different seed differs),
  grid size, [0,relief] + 1.5 cap, and the field lifts tileToWorld.

Deviation from plan ordering: procedural is wired first (fully testable
headless, no assets); authored heightmap PNGs land with the editor brush in T4.
Picking still resolves the right tile (height only moves Y; worldToTile floors
x/z). Material blend (T2) still uses the checker texture this phase.

**Verified**: `world:check` green — typecheck clean, 210 tests (+5), build ok.

- [x] TERRAIN T1 — displaced procedural terrain; DT: on-device visual pass (relief readability, pick accuracy on slopes).
