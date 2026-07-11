# Testing

How PocketRPG stays regression-resistant. Deep rationale: `docs/testing-strategy-review.md`; rollout: `docs/testing-strategy-delivery-plan.md`; per-session rules: `.claude/rules/testing.md` (auto-loads on `tests/**`).

## The strategy in ten lines

- **Vitest, logic-only** (`tests/**/*.test.ts`, node env). Pure engine + server logic; no UI rendering. `npm test` runs it; `npm run test:coverage` adds v8 coverage.
- **Tests are the primary net** (there is no full type-check of the app and no linter), so their gaps are load-bearing — new logic must be reachable by a test.
- **CI** (`.github/workflows/logic-regression.yml`) runs the suite once with coverage, the coverage ratchet, and — on PRs — the changed-lines and UI-zone gates, then the build/single-file checks. A second job type-checks and tests the `world/` subproject.
- **Four automated gates** hold the line:
  - `scripts/check-coverage-ratchet.cjs` — per-directory uncovered-line count never rises (`coverage-baseline.json`).
  - `scripts/check-diff-coverage.cjs` — a PR's added source lines are >=90% covered.
  - `scripts/check-ui-ratchet.cjs` — the untestable JSX zone (`App.jsx`/state/screens/components) never grows (`ui-loc-baseline.json`), forcing logic into importable modules.
  - `npm run typecheck` — `// @ts-check`-annotated files are type-checked (a growing allowlist; `tsconfig.typecheck.json`).
- Ratchets/gates are **report-only** until their `*_BLOCKING` env is set (one release after landing).
- If CI fails on a gate, the message names the file/line and the fix: add a test, move logic out of JSX, or update a baseline with a justification.

## Feature -> test -> source-of-truth map

| Area | Tests | Source of truth |
|---|---|---|
| Task-result apply (idle/skip/live/MCP parity) | `applyTaskResultParity`, `gatherInventoryRouting`, `idle-skilling` | `src/engine/applyTaskResult.js` |
| Combat tick / max hit / accuracy | `combat-*`, `tick`, `formulas`, `monster-maxhit-by-style` | `src/engine/combat.js`, `combatPrimitives.js`, `formulas.js` |
| Idle / offline catch-up / skip-hour | `idle-combat`, `idleElapsed`, `skipPreflight`, `*SkipCost` | `src/engine/idleEngine.js`, `skipPreflight.js` |
| Journeys / clues / teleports | `journeys`, `questIdleCascade`, `teleports`, `travel` | `src/engine/journeys.js`, `teleports.js`, `travel.js` |
| Prayer / combo food | `prayerDrain`, `consumables` | `src/engine/prayerDrain.js`, `consumables.js` |
| Slayer / daily tasks | `slayer*`, `dailyTasks*` | `src/engine/slayer*.js`, `dailyTasks.js` |
| Drops / collection log / content contracts | `data-contracts`, `collectionLog`, `seedDrops`, `*RewardsData` | `src/data/*.json`, `src/engine/seedDrops.js` |
| Save / sync integrity | `saveEndpoint`, `saveRevisionMandatory`, `totalLevelRegression`, `criticalSavePolicy` | `functions/api/save.js`, `functions/_lib/game/saveValidation.js` |
| Server-authoritative grants | `actionCompletion*`, `rewardClaimAuthority`, `serverAuthority` | `functions/api/actions/**` |
| PvP | `pvp*` | `functions/_lib/pvp*`, `src/engine/pvp*` |
| MCP / chat | `mcp*`, `chat*` | `functions/api/mcp.js`, `functions/_lib/chat/**` |

## Adding tests

Follow `.claude/rules/testing.md`: bug fix => failing test first in the same PR; new behaviour => test in the same diff; logic that can't be tested where you write it moves to `src/engine`/`functions/_lib`. New CLAUDE.md gameplay invariant (§4-§7) => a matching test in the same change.
