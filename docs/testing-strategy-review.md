# Testing Strategy Review & Plan

**Status: plan, not yet implemented.** Investigation of the test suite after the skip-1h (#729) and double-loot (#725) regressions: findings, then a phased plan for the implementing agent. No code was changed in this review.

## Verdict

The engine is well tested; the regressions did not come from untested engine code. They came from the **orchestration layer** — `src/App.jsx` (3,386 lines) and `src/state/gameState.jsx` (1,392 lines) — which applies engine results to save state and which the logic-only suite structurally cannot reach. Both recent regressions are the same failure class: **duplicated apply-result logic drifting from an undocumented result contract**. Fixing the test *strategy* means making that layer testable and encoding the invariants that today live only as prose in CLAUDE.md.

## Current state (verified 2026-07-10)

- 173 test files, 2,246 tests, all green, **15.5s** wall time. Fast enough to grow several-fold.
- Vitest, node environment, `tests/**/*.test.ts` only. No JSX/Preact rendering, no jsdom.
- Every `src/engine/*` module is referenced by at least one test. Server endpoints (`functions/api/**`) are tested with per-file hand-rolled D1 mocks (regex-on-SQL fakes, e.g. `tests/saveEndpoint.test.ts`).
- CI (`.github/workflows/logic-regression.yml`) runs `npm run ci` on every push/PR; `build`'s `prebuild` hook runs the suite, so CI does execute all tests.
- Shared helpers are minimal: `tests/helpers/` has 3 tiny files (builders, assertions, `mockRandomSequence`).
- No coverage tooling. No property-based testing.
- Script duplication: `test` (`vitest run`) and `test:logic` (`vitest run --config vitest.config.ts`) are identical — `vitest.config.ts` is the default config. CLAUDE.md §11's claim that `npm run ci` "does not run full `npm test`" is stale.

## Why the named regressions escaped

**Double loot on gathering (#725).** `src/engine/applyTaskResult.js` declares itself the single source of truth for "apply sim result → save state" and is shared by `gameState.jsx` and MCP intents. But `App.jsx` carries at least **three more hand-rolled apply blocks** (~lines 1150, 1999, 2592) that re-implement the same mapping. The bug was one of them re-applying `itemsGained` after `finalInventory` + `itemsBanked` had already been applied — the field semantics (`itemsGained` is the *net total* of the other two for skill/gather) exist only in a code comment added by the fix. No test could catch it: the buggy code lives in JSX the suite never imports, and no contract test pins what each result field means per task type.

**Skip 1h completing a journey (#729).** The invariant "1 credit = exactly one hour of trail time; longer journeys park mid-trail" was written in CLAUDE.md §14 *before* the bug, but no test encoded it. The regression shipped, and the test (`journeys.test.ts`: "a single hour into a long quest journey advances only the hour") was added only in the fix. Prose invariants are not executable.

**The general pattern.** One gameplay feature runs through up to four code paths — live tick loop (App.jsx), idle/offline catch-up (`idleEngine.js`), skip-1h (`skipPreflight.js` + App.jsx travel/skill branches), and MCP save-intents — each with its own apply wiring. Only one parity test exists (`applyTaskResultParity.test.ts`). Four tests resort to `readFileSync` + regex on JSX source (`criticalSavePolicy`, `combat-monster-death`, `constructionPlanks`, `equipmentSlotNames`) — proof that contributors wanted coverage there and the harness couldn't express it.

## Plan for the implementing agent

Ordered by payoff. Each phase is independently shippable; run the CLAUDE.md §11 commit gate per phase. Phases 1–3 are the core; 4–6 are hardening.

### Phase 1 — Prove the strategy on the two known regressions

Before any refactor, write the tests that *would have caught* #725 and #729 against current code:

- A conservation test for task completion: for each task type, applying a sim result must change bank+inventory totals by exactly the sim's declared gains — never twice. This requires Phase 2's extraction to cover the App.jsx paths, so start with `applyTaskResult.js` and note the gap.
- Port the skip-1h journey test pattern to every skip-eligible task type (skill, gather, combat, travel/journey, slayer): one credit advances exactly one hour, never more.

Deliverable: failing-test-first proof that the framework catches this regression class.

### Phase 2 — One apply path (the structural fix)

Extract the three App.jsx apply blocks onto `applyTaskResult.js` (extending it where App.jsx handles cases it doesn't — thieving inventory routing, rune deduction, clue chaining). Delete the duplicates. This is a behaviour-preserving refactor; the Phase 1 conservation tests plus existing suite are the safety net, and `applyTaskResultParity.test.ts` extends to cover every consumer: live completion, background completion, idle claim, MCP intent.

Then pin the contract:

- Document the sim-result shape (`TaskResult`) in JSDoc typedefs in `applyTaskResult.js`: which fields each task type emits, and which are **net** (`itemsGained` for skill/gather) vs **additive** (`itemsBanked`, `lootBanked`), per the #725 comment.
- Add a contract test that runs each engine producer (`skilling.js`, `gatherTasks.js`, `idleEngine.js`, `combat.js`, `journeys.js`, hunter, thieving, agility) and asserts its output conforms — shape and net/additive arithmetic (`itemsGained ≈ inventory delta + itemsBanked`).

After this phase the double-loot class of bug is impossible to reintroduce without a red test.

### Phase 3 — Invariant spec pack: tests as agent-readable deep spec

Encode every CLAUDE.md §4–§7 gameplay invariant as a named test, one file per domain, under `tests/spec/` (e.g. `tests/spec/skipHour.spec.test.ts`, `spec/prayerDrain.spec.test.ts`, `spec/comboFood.spec.test.ts`, `spec/inventoryCap.spec.test.ts`, `spec/journeys.spec.test.ts`). Conventions that make these serve agents as documentation:

- File header comment: the invariant in one sentence + the CLAUDE.md section it encodes + the source-of-truth module.
- Test names are full behavioural sentences ("skip-1h on a 10h journey advances exactly one hour and parks mid-trail"), so `grep -r "skip" tests/spec/` reads as a spec.
- Many existing tests already qualify — *move/rename rather than rewrite*. The pack is a curated index, not a second suite.

Add **`TESTING.md`** (repo root, short): the strategy in ten lines, the feature → spec-file → engine-module map, and the two authoring rules (new invariant ⇒ spec test in the same change; bug fix ⇒ failing test first, in the spec file if it's an invariant). Reference it from CLAUDE.md §11 in one line. This gives a future agent debugging a hard bug a place to load "how this system should behave in deep detail" on demand — without bloating every session's context.

### Phase 4 — Parity harness for multi-path features

Systematic parity tests per task type: N minutes of live ticking, idle catch-up of N minutes, and skip-1h must produce identical XP/loot from identical state and seeded RNG (via `tests/helpers/random.ts`), except where a difference is deliberate — assert the documented exceptions explicitly (gather auto-bank perk applies to idle/skip only; live gathering stops on full inventory, CLAUDE.md §4).

### Phase 5 — Measurement and gate hygiene

- Add `@vitest/coverage-v8` and a `test:coverage` script. Report per-directory; set a ratchet threshold on `src/engine/` + `functions/` (they should be near-total) and **track** `src/state/` + `src/App.jsx` without gating on them yet.
- Collapse `test`/`test:logic` into one script; fix the stale §11 sentence in CLAUDE.md in the same change.
- Extract a shared fake-D1 helper into `tests/helpers/` and migrate endpoint tests opportunistically (only when touching a file anyway — no big-bang rewrite).

### Phase 6 — Retire the source-regex tests

Replace the four `readFileSync`-on-JSX tests with real behavioural tests where Phase 2's extraction makes the logic importable. Any remainder that genuinely guards UI wiring: keep, but mark with a header comment explaining why it greps source. Do **not** add a broad jsdom/preact rendering harness — the payoff is in the apply/orchestration logic, which Phase 2 makes testable in node; UI rendering tests would slow the suite for little regression value.

## Process rules to adopt (for CLAUDE.md/TESTING.md, small)

1. **Bug fix ⇒ the failing test lands in the same PR, written first.** Already folklore; make it a stated gate.
2. **New/changed CLAUDE.md gameplay invariant ⇒ matching spec test in the same change** (mirrors the existing memory-hygiene same-change rule).
3. **Changing a sim-result shape ⇒ the contract test must change in the same diff** — the contract test's existence enforces this mechanically.

## Explicitly out of scope

- E2E/browser automation, visual regression, device testing — different cost class, not what failed here.
- Server-side re-simulation of the tick loop — §14 deliberately trusts the client save blob; do not turn tests into an anti-cheat argument.
- Rewriting healthy existing tests for style.

## Open decisions for the maintainer

1. Phase 2 extends `applyTaskResult.js` vs. a new `engine/completion.js` — implementing agent should propose after sizing the App.jsx blocks (extending is the default assumption).
2. Whether coverage ratchet failures should block CI or just report (recommend report-only for one release, then gate).
