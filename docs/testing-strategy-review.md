# Testing Framework Review & Hardening Plan

**Status: plan, not yet implemented.** A full review of PocketRPG's testing framework: what it covers, what it structurally cannot cover, which tests carry no value, and the mechanics needed so future logic ships proven by tests. Written for the implementing agent; measurements verified 2026-07-10 on `main` (e4f9020).

## Method

Full suite run; two coverage runs (`@vitest/coverage-v8`, default loaded-files denominator vs `--coverage.include` full denominator); taxonomy audit of all 174 test files; determinism audit of `src/engine`; enforcement audit (CI, typecheck, lint, gates); duplicate/skip scan; last-30-commit test-discipline sample.

## 1. The framework today

- Vitest 4, single node-environment project, `tests/**/*.test.ts` only. 173 files, 2,246 tests, **15.5s** — fast, green, room to grow several-fold.
- CI (`logic-regression.yml`) runs `npm run ci` on every push/PR; the `prebuild` hook executes the full suite. `npm test` and `npm run test:logic` are the same command (CLAUDE.md §11's "ci does not run full npm test" is stale).
- Shared infra is thin: `tests/helpers/` is 3 small files (builders, one assertion, `mockRandomSequence` which monkey-patches `Math.random`). Every server test hand-rolls its own regex-on-SQL D1 fake (~40–60 lines each across ~20 files).
- **Nothing else guards the code.** No coverage tooling. No typechecking: there is no root `tsconfig.json`; `tsconfig.build.json` is emit-only (no `strict`), and Vitest transpiles tests without checking them — a type error in a `.test.ts` file only fails if it changes runtime behaviour. No linter. No jsdom/rendering project. Tests are the *only* automated net, which makes their gaps load-bearing.

## 2. Measured coverage — the real numbers

The default coverage report says **74.8% lines**, but it only counts files some test imports. With the full `src/**` + `functions/**` denominator:

| Area | Lines | Coverage | Notes |
|---|---|---|---|
| `src/engine` | 4,565 | 78.2% | but `combat.js` — the largest gameplay file, 985 lines — is **39.7%** |
| `functions/_lib` | 3,005 | 76.9% | `mcp/tools.js` 45.7%, `pvp.js` 13%, `pvpMatchCreate.js` 0% |
| `functions/api` | 2,073 | **42.1%** | see integrity-boundary list below |
| `src/utils` | 659 | 76.3% | |
| `src/cloud` | 637 | **46.3%** | `api.js` 12.7% — the sync/save transport |
| `src/db` | 204 | **22.5%** | IndexedDB save/load — data-loss bug class |
| `src/App.jsx` + `gameState.jsx` | 2,374 | **0%** | orchestration: task completion, idle claim, skip-hour wiring |
| `src/screens` + `components` + `hooks` | 7,758 | ~0% | UI — mostly fine to leave, but logic hides here |

Server endpoints at or near zero that sit **on the §14 integrity boundary** (server-authoritative money/progression — exactly where CLAUDE.md says correctness must live): `purchase.js` **6.7%**, `idle.js` **0%**, `activity-progress.js` **0%**, `pvp/match/[id]/tick.js` **4.9%**, `pvp/invitations/*` **0%**, `stripe/create-session.js` **0%**, both OAuth login callbacks **0%**, `_lib/oauth/store.js` **0%**.

Ten server files are not referenced by any test at all (also: `admin/backfill-levels.js`, `trading-post/my-offers.js`, `_lib/pvpLobby.js`, `_lib/game/monsterRewards.js`, `api/_middleware.js`).

Discipline is not the problem — 29 of the last 30 code commits touching `src/engine`/`functions` also touched `tests/`. The problem is that nothing *measures or enforces* whether those tests exercise the changed lines, and that whole layers are structurally untestable.

## 3. Crucial gaps, ranked

**G1 — Logic can live where tests can't reach.** `App.jsx` (3,386 lines) and the screens embed real game logic (task-result application, idle claim, journey chaining, inventory routing). The node-only harness cannot import JSX wired to Preact context, so this logic is untestable *by construction* — and nothing stops the next feature from landing there too. Four tests resort to `readFileSync` + regex on JSX source (`criticalSavePolicy`, `combat-monster-death`, `constructionPlanks`, `equipmentSlotNames`): proof of demand for coverage the framework can't express.

**G2 — No second net.** With no typecheck and no lint, every contract between modules (e.g. which sim-result fields are net vs additive) is enforced only by tests that remember to check it. Cheap wins are unclaimed: strict-checking `tests/**` alone would catch stale fixtures at CI time.

**G3 — Coverage is invisible, so "tests pass" masquerades as "change is tested".** A PR can add 300 uncovered lines to `functions/api` and CI stays green. There is no per-PR changed-lines signal and no ratchet holding won ground.

**G4 — Integrity-boundary endpoints are the least-tested code in the repo** (table above), inverted from the §14 doctrine that these are the paths that must be right. Failure modes (missing auth, replayed nonce, insufficient credits, stale revision, double-settlement) are exactly the kind of thing hand-rolled per-file D1 fakes discourage writing.

**G5 — Determinism is monkey-patched, not designed.** 26 `Math.random` call sites in `combat.js` alone; 8 engine files read `Date.now()` directly. Tests cope via `vi.spyOn(Math, 'random')` and fake timers, which breaks silently when call order changes — a max-hit assertion can pass for the wrong reason. Some modules already do it right (`journeys.js` seeds deterministically); the pattern isn't uniform.

**G6 — One feature, four untested-in-parallel paths.** Live tick loop, idle/offline catch-up, skip-1h, and MCP save-intents each re-implement "simulate then apply". `applyTaskResult.js` documents itself as the single apply path, but `App.jsx` carries at least three hand-rolled variants (~lines 1150, 1999, 2592). One parity test exists (`applyTaskResultParity.test.ts`); parity is otherwise unasserted. Both July regressions (#725 double loot, #729 skip-1h) were drift inside this unasserted zone.

**G7 — Mirror-list tests train the wrong reflex.** Several data tests hand-maintain expectation lists that duplicate the data (e.g. `data-contracts.test.ts`'s ~60-entry `EXPECTED_BOSS_UNIQUE_ITEM_IDS`). When they fail on legitimate content changes, the fix is "append to the list" — the test degrades into a change-detector that teaches contributors to update tests to match code, the exact habit that lets regressions through.

## 4. Tests to prune or upgrade (less noise, same protection)

A test earns its place when its failure points at a defect a player or the economy would feel. Against that bar:

- **Delete** `tests/item-value.test.ts` — strict subset of `tests/itemValue.test.ts` (both test `isLegendaryItem`; the kebab/camel naming split invited the duplicate). Pick one naming convention and state it.
- **Delete or fix** the `describe.skip` auth suite in `tripoMcp.test.ts` — permanently skipped tests are negative value: they read as coverage and assert nothing (the suite's 3 "skipped" are these).
- **Replace** the four source-regex tests with behavioural tests as G1's extraction lands; any that must remain get a header comment saying what wiring they guard and why regex.
- **Convert** mirror-list assertions to derived invariants: instead of enumerating every boss unique, assert structural rules (every drop-table unique has a collection-log slot; every referenced item exists; uniques above value X come from a server-authoritative grant path). Enumerations live in `src/data`, not tests.
- **Keep** the data referential-integrity tests (`data-contracts`, `collectionLog`, `itemSources`, …) — they are the cheapest high-value class in the suite and back the `add-content` skill.

## 5. The plan

Phased; each phase is one or two independently shippable PRs passing the §11 gate. A/B are the framework itself; C/D close the gaps; E makes tests serve agents as deep spec.

### Phase A — Make the net visible

- Add `@vitest/coverage-v8`; configure `coverage.include: ['src/**', 'functions/**']` (full denominator, exclude `src/assets`, `src/data`, vendored code) with `json-summary` output. `npm run test:coverage`.
- CI job publishes the per-directory table and enforces a **ratchet**: a checked-in `coverage-baseline.json`; a directory's coverage may rise or hold, never drop. Report-only for the first release, then blocking.
- Housekeeping in the same PR: collapse `test`/`test:logic`, fix the stale §11 sentence, delete the duplicate and skipped tests (§4).

### Phase B — Gate future changes ("delivered means proven")

- **Changed-lines coverage gate**: a small CI script (git diff + coverage JSON, no SaaS) requiring executable lines *changed in the PR* under `src/engine`, `src/utils`, `src/cloud`, `src/db`, `functions/**` to be ≥90% covered. This is the mechanical form of "features must be proven with tests" — it fires only on the diff, so legacy debt doesn't block unrelated work.
- **Untestable-zone ratchet**: CI fails if `src/App.jsx` or `src/state/gameState.jsx` *grows* (line-count baseline file). New logic must land in importable modules; the ratchet makes G1 self-correcting instead of aspirational.
- **Typecheck as a second net**: root `tsconfig.json` with `strict: true` covering `tests/**` (checked, catches fixture drift immediately) plus `checkJs` on `src/engine` + `functions/_lib` via JSDoc types — start with the module contracts (`TaskResult` in `applyTaskResult.js`). `npm run typecheck` joins `npm run ci`. Full TS migration is *not* required and not proposed.
- **Path-scoped rule `.claude/rules/testing.md`** (auto-loads on `tests/**`, `src/engine/**`, `functions/**`) encoding the working rules for agents: bug fix ⇒ failing test first, in the same PR; new behaviour ⇒ test in the same diff (the gate enforces it, the rule explains it); logic you cannot test where you're writing it gets moved to `src/engine`/`functions/_lib`, not wired into JSX; never fix a red test by widening its expectation to match new output without stating why the new behaviour is correct; no new mirror lists, no new source-regex tests.

### Phase C — Close the crucial coverage gaps (risk-ordered)

Build the shared test infra once, in C1, then spend it:

1. **Shared fake-D1 + request-context helper** in `tests/helpers/d1.ts` (tables as maps, batch/first/run recording), replacing per-file regex fakes opportunistically. Then **`purchase.js`**: happy path, insufficient coins, unknown item, replay, audit-event emission.
2. **Idle claim surface**: `api/idle.js`, `activity-progress.js` — grant paths, idempotency, PvP lockdown.
3. **PvP match lifecycle**: invitations accept/decline, `pvpMatchCreate`, match tick endpoint, settlement double-spend.
4. **`combat.js`**: raise from 40% by extracting the live-fight tick's pure steps (target selection, proc rolls, drain application) into testable functions — coverage via extraction, not via simulating the UI.
5. **Save pipeline**: `src/cloud/api.js` + `src/db` round-trip tests (save → serialize → load → identical state) and failure injection (timeout mid-save, revision conflict) extending `criticalSavePolicy`.
6. **Auth callbacks + OAuth store**: token exchange failure modes, state mismatch.

Explicitly deprioritised: screens/components rendering, pixels, e2e browser automation — different cost class; the regression record doesn't point there.

### Phase D — Structural fix for the parallel paths (G5/G6)

- Unify the apply paths: fold `App.jsx`'s three apply blocks into `applyTaskResult.js`; document the `TaskResult` contract as JSDoc typedefs (which fields each task type emits; which are net vs additive); add a producer-contract test that runs every engine simulator and checks conformance arithmetically (`itemsGained ≈ inventory delta + itemsBanked`).
- **Parity harness**: for each task type, N minutes live-ticked vs idle catch-up vs skip-1h from identical seeded state must agree on XP/loot, with the documented exceptions (e.g. gather auto-bank perk is idle/skip-only) asserted explicitly as exceptions.
- **Injectable randomness/clock**: introduce `rng` and `now` parameters (defaulting to `Math.random`/`Date.now`) in engine entry points as they're touched — no big-bang; `mockRandomSequence` retires gradually.

### Phase E — Tests as deep spec for agents

The suite should be the on-demand "how this system really behaves" context an agent loads for a hard bug — precise where CLAUDE.md is terse, and free until needed.

- `tests/spec/` pack: one file per invariant domain (`skipHour`, `prayerDrain`, `comboFood`, `inventoryCap`, `journeys`, `dailyTasks`…), encoding every CLAUDE.md §4–§7 invariant. Conventions: file header = the invariant + its CLAUDE.md section + source-of-truth module; test names are full behavioural sentences so `grep -r skip tests/spec/` reads as a spec. Mostly *moves and renames* of existing good tests — a curated index, not a second suite.
- **`TESTING.md`** (root, ~1 page): the strategy, the feature → spec-file → module map, the Phase B working rules. One reference line added to CLAUDE.md §11.
- Optional, cheap to try: a monthly/on-demand **mutation-testing spot check** (Stryker) on `src/engine` to find tests that execute lines but assert nothing — the failure mode raw coverage can't see. Run out-of-band, never in the PR gate.

## 6. Success criteria

- Full-denominator line coverage: `functions/api` ≥ 80%, `src/engine` ≥ 90% (incl. `combat.js` ≥ 75%), `src/cloud` + `src/db` ≥ 80%; ratchet green thereafter.
- Changed-lines gate active and blocking; `App.jsx`/`gameState.jsx` line counts monotonically shrinking.
- Zero permanently-skipped tests, zero duplicate files, zero new source-regex or mirror-list tests.
- Every §14 integrity endpoint has explicit failure-mode tests (auth, replay/idempotency, insufficient funds, stale revision).
- Suite stays under 60s so the prebuild hook remains viable.

## Open decisions for the maintainer

1. Changed-lines threshold (proposed 90%) and how long the coverage ratchet stays report-only before blocking (proposed one release).
2. `checkJs` rollout order for engine JSDoc types (proposed: start at `applyTaskResult.js` and the simulators).
3. Whether a tiny jsdom Vitest project for `src/state`/`src/hooks` is wanted after Phase D — only if extraction leaves meaningful wiring untested; default is no.
