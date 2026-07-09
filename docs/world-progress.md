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
