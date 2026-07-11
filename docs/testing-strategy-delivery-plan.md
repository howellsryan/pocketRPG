# Testing Strategy — Delivery Plan

Execution playbook for the phased plan in `docs/testing-strategy-review.md`. One PR per numbered item, in order — later PRs depend on earlier machinery. Written for an implementing agent; every PR states its scope, steps, and acceptance criteria. Read the review doc first for the *why*; this doc is the *how*.

## Ground rules (apply to every PR)

1. **One PR = one numbered item below.** Adjacent problems get flagged in the PR description, never fixed in the same diff (scope-fence).
2. **Commit gate before every commit**: `npm test && npm run build && npm run rebuild && npm run check:single` (CLAUDE.md §11). CI must be green before starting the next PR.
3. **Never fix a red test by widening its expectation** to match new output. If current behaviour is wrong, say so in the PR and change the code; if the test is wrong, explain why in the diff.
4. **No `any`-casting to silence type errors** in PR 4+ — type the fixture or the contract instead. An `as any` needs an inline comment justifying it.
5. **PR titles/bodies are the public changelog** (CLAUDE.md §20). All of these are internal: one honest player-facing line, e.g. "Behind the scenes: stronger automated test checks." No file paths, no tool names in the body.
6. **If a step's cost blows past ~2× the estimate** (e.g. typecheck errors ballooning), stop, commit what's green, and report — don't bulk-suppress to force completion.
7. Never touch `index.html` / `game-*.js`; generated (§12).

---

## PR 1 — Restore tripo-mcp bearer auth (security, ship first)

**Scope**: `functions/api/tripo-mcp.js`, `tests/tripoMcp.test.ts` only.

1. In `functions/api/tripo-mcp.js`, re-enable both `requireTripoAuth(request, env)` call sites per the `TODO(security)` comment at the top of the file (the helper exists: `functions/_lib/tripo/auth.js:21`). Delete the TODO.
2. Remove `describe.skip` at `tests/tripoMcp.test.ts:84`; run the suite; fix the tests only if they've drifted from the handler's current response shapes (they were written against the auth'd behaviour).
3. Acceptance: `npm test` reports **0 skipped**; unauthenticated POST/GET to the handler in tests gets 401.

## PR 2 — Coverage visibility + housekeeping (review Phase A)

**Scope**: `vitest.config.ts`, `package.json`, `.github/workflows/logic-regression.yml`, one new script, `CLAUDE.md` §11, two test files, `.gitignore`.

1. `npm install -D @vitest/coverage-v8` (match the installed Vitest 4.1.x major).
2. In `vitest.config.ts` add:
   ```ts
   coverage: {
     include: ['src/**', 'functions/**'],
     exclude: ['src/assets/**', 'src/data/**', '**/vendor/**'],
     reporter: ['text-summary', 'json', 'json-summary'],   // 'json' is required by PR 3
     reportsDirectory: './coverage',
   }
   ```
   Gitignore `/coverage`.
3. Add script `"test:coverage": "vitest run --coverage"`.
4. New `scripts/check-coverage-ratchet.cjs`: read `coverage/coverage-summary.json`, aggregate **uncovered-line counts** per top-level directory (`src/engine`, `src/utils`, `src/cloud`, `src/db`, `functions/api`, `functions/_lib`), compare against a checked-in `coverage-baseline.json`; fail if any count **rises**; `--update` flag rewrites the baseline. Print the per-directory table either way. (Counts, not percentages — deleting covered dead code must not fail the check.)
5. CI: rework `logic-regression.yml` so the suite runs **once**: `npm run test:coverage` → `node scripts/check-coverage-ratchet.cjs` → `npx vite build` (bypasses the `prebuild` re-run; comment why in the workflow) → `npm run rebuild` → `npm run check:single`. Add a separate step: `cd world && npm ci && npm run typecheck && npm test` (the root `world:check` script also builds; CI needs check+test only).
6. Housekeeping, same PR: merge the unique cases of `tests/item-value.test.ts` (missing-item, zero-value, stack-quantity regression) into `tests/itemValue.test.ts` and delete the file; change `"prebuild"` to `"npm test"` and delete `"test:logic"`; fix the stale §11 sentence in CLAUDE.md ("does not run full `npm test`") in the same change (memory-hygiene).
7. Ratchet is **report-only** for this PR (exit 0 with a warning); flipping it to blocking is a one-line follow-up after one release of quiet operation.
8. Acceptance: CI green; suite executes exactly once per CI run; baseline file committed; table visible in CI logs.

## PR 3 — Changed-lines gate + untestable-zone ratchet (review Phase B)

**Scope**: two new scripts, workflow, two baseline files. Depends on PR 2's `json` reporter.

1. `scripts/check-diff-coverage.cjs`:
   - `git diff -U0 origin/main...HEAD -- src/engine src/utils src/cloud src/db functions` → added line numbers per file.
   - Look each file up in `coverage/coverage-final.json` (istanbul format; keys are absolute paths — normalise). An added line counts only if it appears in the coverage map as executable; require **≥90%** of counted lines covered, else exit 1 listing the uncovered `file:line`s.
   - Runs in CI **only on `pull_request` events** (no merge-base on bare pushes). Emergency override: `SKIP_DIFF_COV=1` env on the workflow dispatch, logged loudly.
2. `scripts/check-ui-ratchet.cjs`: count non-blank, non-comment lines **aggregated** across `src/App.jsx`, `src/state/`, `src/screens/`, `src/components/`; fail if the total exceeds `ui-loc-baseline.json`; `--update` rewrites it. Aggregate, so logic can't dodge into a new screen file. A PR that legitimately grows UI updates the baseline in the same diff with a one-line justification in the PR description.
3. Wire both into the workflow after the coverage step, `if: github.event_name == 'pull_request'`.
4. Verify before merging: on a scratch branch, add an uncovered function to `src/engine/formulas.js` and confirm the gate fails; add 50 lines to a screen and confirm the ratchet fails. Include the (reverted) proof in the PR description.
5. Acceptance: both checks demonstrably fire; baselines committed; normal doc-only PRs pass untouched.

## PR 4 — Typecheck as a second net (review Phase B, sequenced)

**Scope**: JSDoc in ≤3 engine files, new tsconfig, `package.json`, test-file type fixes.

1. First: JSDoc typedefs for the **`TaskResult` contract** in `src/engine/applyTaskResult.js` (fields per task type; net vs additive semantics in the doc comments) + `// @ts-check` pragma on that file only. Fix in-file errors. This is the highest-value contract and shrinks downstream test-file errors.
**DELIVERED (this pass):** step 1 — `TaskResult` JSDoc contract + `// @ts-check` on `src/engine/applyTaskResult.js` (0 errors). `tsconfig.typecheck.json` uses **`checkJs: false` + per-file `// @ts-check`** so only annotated files are checked and untyped imports are inferred, not reported — a green, enforceable allowlist that grows one pragma at a time. `npm run typecheck` is wired into `npm run ci`.

**MEASURED & DEFERRED (ground rule 6):** the alternative — strict-checking all of `tests/**` — was scaffolded and measured at **423 errors across 67 files** (dominant `TS2339`/`TS7018`, the `{}`-inference-from-untyped-JS the peer review predicted). That is at the 2× budget ceiling and most fixes would need forbidden `as any` casts, so the tests/** strict pass is deferred until the engine files it imports are annotated. It must be sequenced AFTER the engine-JSDoc follow-up, not before.

**Follow-ups (separate PRs, opportunistic):** add JSDoc + `// @ts-check` to the next engine contracts (the simulators, `experience.js`, `constants.js` — the latter two are `applyTaskResult`'s only transitive gaps), each joining `npm run typecheck` automatically; then revisit the tests/** pass; enable `strictNullChecks` when annotated files can bear it. Never tsconfig-level `checkJs` — measured too expensive via transitive imports (12 errors from `applyTaskResult`'s deps alone).

## PR 5 — Agent working rules: `.claude/rules/testing.md` + `TESTING.md`

**Scope**: two new files, one line in CLAUDE.md.

1. `.claude/rules/testing.md`, path-scoped to **`tests/**` only** (§17 token discipline). Contents — terse, one line each: bug fix ⇒ failing test first, same PR; new behaviour ⇒ test in the same diff; logic you can't test where you're writing it moves to `src/engine`/`functions/_lib`, never into JSX; no real clock (`vi.setSystemTime`); no widening expectations to match new output without justifying the new behaviour; no new mirror-list tests (derive invariants from data); no new source-regex tests; naming = camelCase test files, test names are full behavioural sentences.
2. `TESTING.md` (root, ~1 page): the strategy in ten lines, the feature → test-file → source-of-truth-module map (seed from the review doc's tables), and the PR gates from PRs 2–3 so contributors know why CI failed.
3. One pointer line added to CLAUDE.md §11. Nothing else in CLAUDE.md grows.

## PRs 6–11 — Coverage backlog (review Phase C, one PR each, in this order)

Shared step for PR 6, spent by the rest: **`tests/helpers/d1.ts`** — a fake D1 with tables as maps, recording `prepare/bind/first/all/run/batch` calls, replacing per-file regex fakes only in files the PR already touches.

6. **Money**: (a) migration-schema test — `npm i -D better-sqlite3`, apply all `migrations/*.sql` in filename order to an in-memory DB, then execute the *actual SQL strings* used by `purchase.js`/`save.js` against it (schema-drift tripwire for all the map-based fakes); (b) `purchase.js`: no auth → 401, unknown item → 4xx, insufficient coins → 4xx and **no** debit, success → atomic debit+grant+audit row, replay → no double-grant; (c) `stripe/create-session.js`: auth required, product/price mapping, payload shape.
7. **PvP settlement/lifecycle**: invitations accept/decline (`functions/api/pvp/invitations/*`), `_lib/pvpMatchCreate.js`, match tick endpoint, settlement double-spend (two settle calls → one payout).
8. **Identity**: GitHub/Google OAuth callbacks (state mismatch, token-exchange failure, happy path) + `_lib/oauth/store.js`.
9. **Save pipeline**: `src/cloud/api.js` + `src/db` round-trip (save → serialize → load → deep-equal state) and failure injection (timeout mid-save, revision conflict), extending `criticalSavePolicy`.
10. **Persistence guards**: `api/idle.js`, `activity-progress.js` — ownership check, PvP lock, write throttle. (Stamp endpoints — small PR.)
11. **`combat.js` extraction**: pull the live-fight tick's pure steps (target selection, proc rolls, drain application) into exported functions with tests, one step per commit, no behaviour change. Target ≥75% file coverage. This PR feeds PR 12.

## PRs 12–14 — Structural fix (review Phase D)

12. **Apply-path unification**: first add characterization tests capturing what each of `App.jsx`'s three apply blocks (~lines 1150, 1999, 2592) currently does via `applyTaskResult`-shaped inputs; extend `applyTaskResult.js` to cover the gaps (thieving inventory routing, rune deduction, clue chaining); then swap the three call sites **one per commit**, deleting each block as it's replaced. `applyTaskResultParity.test.ts` grows to cover all four consumers. The PR 3 diff-coverage gate applies in full here.
13. **Parity harness**: per task type, N minutes live-ticked vs idle catch-up vs skip-1h from identical seeded state agree on XP/loot; documented exceptions (gather auto-bank perk) asserted *as* exceptions. Cap at a few seconds per task type; pick N to fit.
14. **Injectable determinism**: add optional `rng`/`now` params (defaulting to `Math.random`/`Date.now`) to engine entry points **as PRs 11–13 touch them** — no standalone sweep. `mockRandomSequence` retires from files as they convert.

## PR 15 — Spec pack (review Phase E)

Create `tests/spec/`, one file per invariant domain (`skipHour`, `prayerDrain`, `comboFood`, `inventoryCap`, `journeys`, `dailyTasks`, `dragonfire`, `specialAttacks`). Mostly **move + rename** existing tests; write new ones only for CLAUDE.md §4–§7 invariants with no current test. Header comment per file: the invariant, its CLAUDE.md section, the source-of-truth module. Update `TESTING.md`'s map. Optional afterwards, out-of-band: a monthly Stryker mutation run over `src/engine` — never in the PR gate.

## PR 16 — Drop-table audit script for new monsters / bosses / raids (on-demand, not a build gate)

**Why this is separate from the suite.** `tests/data-contracts.test.ts` already validates drops *structurally* — item exists, `chance ∈ [0,1]`, `quantity` ordered — and that runs in the build. It cannot answer "are these drop **rates** what we expect?", because that's a judgement call against economy/XP thresholds, not a binary. Baking those thresholds into the build would either be too loose to help or fire false failures on every unrelated PR. So this is an **author-run audit**: run it when you add or edit a monster/boss/raid, read the report, decide. It is deliberately **excluded from `npm run ci` and the `prebuild` hook**.

**Scope**: new `scripts/check-drops.cjs`, `package.json` script, one line in the `add-content` skill. No change to `logic-regression.yml`.

**Data shapes it reads** (`src/data/monsters.json`, `raids.json`, `items.json`, `collectionLog.json`):
- Monster/`always` drop: `{ itemId, quantity: number | [min,max], chance: 0..1 }`. Bosses are `monsters.json` entries flagged `boss: true`.
- Raid unique: `rewards.unique = { chance, items: [{ itemId, weight }] }`; per-item effective rate = `unique.chance × weight / Σweight`.

**Invocation**:
```
npm run check:drops -- <monsterId|raidId>   # audit one new/edited entry (the normal case)
npm run check:drops -- --all                 # sweep everything (spot-check the whole economy)
```
Exit non-zero **only on hard errors** (below) so it *can* be wired into a pre-content hook later if wanted; warnings print and exit 0.

**Hard errors (exit 1)** — these are correctness, and belong here rather than the build only because they're cheap to co-locate with the economic checks:
- Dangling `itemId` (not in `items.json`), `chance` outside `(0,1]`, malformed `quantity`.
- A boss/raid **unique** drop with no matching slot in `src/data/collectionLog.json` (mirrors the `add-content` collection-log invariant; today only enforced by a hand-written regression test).
- Boss estimated **Slayer XP/hr > 2× the best regular monster** (CLAUDE.md §8 invariant — uses `BOSS_SLAYER_TASK_XP_MULTIPLIER` from `src/engine/slayerRewards.js`; flags inflated explicit `slayerXP`).

**Warnings (exit 0, author reviews)** — the "are the rates what we expect" report:
- **Expected value per kill**: `Σ(chance × avgQty × item.shopValue)`; derive gp/hr from an estimated kill time (HP / assumed DPS band) and flag outliers vs monsters of similar `combatLevel`.
- **Rarest unique rate** as `1/N` kills (monster) or `1/N` completions (raid); flag uniques rarer than the rarest existing comparable, or common enough to devalue the drop.
- **Drop-table sanity**: chances summing implausibly, a `[min,max]` band an order of magnitude off its tier, a unique whose `shopValue` sits outside the band of that boss/raid's other uniques.
- **Combat XP/hr** for the monster vs its tier, to catch an accidental XP piñata.

Output is a compact per-entry table (value/kill, gp/hr, XP/hr, rarest-unique 1/N, pass/warn/fail per check) the author eyeballs against neighbours in the same tier. Keep the comparison cohort automatic (same `combatLevel` band / same raid group) so the author needn't supply baselines.

**Wire-up**: add one line to `.claude/skills/add-content/SKILL.md` under "After the change" — "New/edited monster/boss/raid → run `npm run check:drops -- <id>` and review the economy report" — so the audit is part of the authoring workflow, not a forgotten script. This is the only edit outside `scripts/` and `package.json`.

**Acceptance**: running `--all` on current `main` exits 0 (today's content is the baseline — if it surfaces a real existing outlier, note it in the PR, don't "fix" the content in this PR); a deliberately broken fixture (dangling item; a unique with no log slot) exits 1; the `add-content` skill references it.

## Sequencing summary

PR 1 is independent — ship immediately. PRs 2 → 3 → 4 → 5 build the framework, in order. PRs 6–11 are parallelisable once 2–3 land (they're what makes the ratchet numbers fall). PRs 12–14 in order, after 11. PR 15 last. PR 16 is independent of the whole series — it touches only `scripts/`, `package.json`, and the `add-content` skill, so it can land any time. Flip the PR 2 ratchet and PR 3 gate to blocking one release after they've run quietly.

## Definition of done

The success criteria in `docs/testing-strategy-review.md` §6, plus: every script added here has a `--help`/usage comment; `TESTING.md` map is accurate on the day PR 15 merges; no PR in the series grew `App.jsx`.
