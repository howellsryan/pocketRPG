# Testing

How PocketRPG stays regression-resistant. Deep rationale: `docs/testing-strategy-review.md`; rollout: `docs/testing-strategy-delivery-plan.md`; per-session rules: `.claude/rules/testing.md` (auto-loads on `tests/**`).

## The strategy in ten lines

- **Vitest, logic-only** (`tests/**/*.test.ts`, node env). Pure engine + server logic; no UI rendering. `npm test` runs it; `npm run test:coverage` adds v8 coverage.
- **Tests are the primary net** (there is no full type-check of the app and no linter), so their gaps are load-bearing — new logic must be reachable by a test.
- **No test CI for the main app** — the logic-regression GitHub Action was removed to save Action minutes. The `npm run ci` commit gate (CLAUDE.md §11) is the net: every commit runs typecheck, the full suite, and the build/single-file checks locally before it lands. `.github/workflows/world-check.yml` still type-checks and tests the `world/` subproject (it runs only on `world/**` changes).
- **Four ratchet/gate scripts** back the suite; they no longer run in CI, so invoke them locally (or wire into the commit gate) when in doubt —
  - `scripts/check-coverage-ratchet.cjs` — per-directory uncovered-line count never rises (`coverage-baseline.json`).
  - `scripts/check-diff-coverage.cjs` — a PR's added source lines are >=90% covered.
  - `scripts/check-ui-ratchet.cjs` — the untestable JSX zone (`App.jsx`/state/screens/components) never grows (`ui-loc-baseline.json`), forcing logic into importable modules.
  - `npm run typecheck` — `// @ts-check`-annotated files are type-checked (a growing allowlist; `tsconfig.typecheck.json`).
- Ratchets/gates are **report-only** until their `*_BLOCKING` env is set (one release after landing).
- If a gate script fails, the message names the file/line and the fix: add a test, move logic out of JSX, or update a baseline with a justification.

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
| Item-loss safety net (§14) | `holdingsDelta`, `saveHistoryRestore`, `saveEndpointItemLoss`, `adminSnapshotSave`, `bankWipeGuard` | `functions/_lib/game/holdingsDelta.js`, `saveHistory.js`, `functions/api/admin/restore-save.js`, `snapshot-save.js`; shadow mode — the detector must never reject (`docs/item-loss-safety-net.md`) |
| Holdings integrity (loadouts, idle write-back) | `equipmentPresets`, `holdingsReconcile`, `bankMutations`, `bankChargePreservation` | `src/engine/equipmentPresets.js`, `holdingsReconcile.js`, `bankMutations.js`, `bankCharges.js` |
| Server-authoritative grants | `actionCompletion*`, `rewardClaimAuthority`, `serverAuthority` | `functions/api/actions/**` |
| PvP | `pvp*` | `functions/_lib/pvp*`, `src/engine/pvp*` |
| Co-op bosses | `coopBoss*`, `coopSessionLock`, `coopProjection` | `src/engine/coopBossEngine.js`, `functions/_lib/game/coopBoss.js`, `functions/_lib/game/coopProjection.js`, `functions/api/coop/**`, `world/server/CoopBossRoom.ts` |
| Co-op live transport | `coopSocket*`, `coopFeed`, `coopPolling` | `src/engine/coopSocketProtocol.js`, `src/cloud/coopFeed.js`, `functions/api/coop/session/[id]/socket.js`, the socket half of `world/server/CoopBossRoom.ts` |
| Co-op integrity (§14) | `coopBossIntegrity` | exactly-once kill settlement, the save-revision write-back tripwire, server-side boss gating, per-member save lock, sweep write-back, retention |
| Combat feedback | `hitSplats`, `xpDrops`, `lootModal` | `src/utils/hitSplats.js`, `src/utils/xpDrops.js`, `src/utils/lootModal.js` |
| Save-lock classification | `saveErrors` | `src/cloud/saveErrors.js` (every lock in `functions/api/save.js` must be listed there) |
| MCP / chat | `mcp*`, `chat*` | `functions/api/mcp.js`, `functions/_lib/chat/**` |

## Invariant specs (`tests/spec/`)

`tests/spec/` is a curated, greppable index of the CLAUDE.md §4–§7 gameplay invariants, one file per domain, each headed with the invariant and its source module (see `tests/spec/README.md`). It's the on-demand "how this should behave in depth" context for a hard bug — precise where CLAUDE.md is terse. Seeded with `inventoryCap` and `comboFood`; existing domain tests (`prayerDrain`, `journeys`, `consumables`, …) are the spec for their areas and migrate in incrementally. New invariants start here.

## Manual browser repros (`scripts/repro-*.mjs`)

Outside `npm test` — they drive a built bundle in a real browser and need
`playwright` installed separately. They exist to reproduce an end-to-end failure
whose durable regression cover is a logic test. Point one at any build root:
`node scripts/repro-preset-item-loss.mjs <build-root>`.

| Repro | Reproduces | Logic test that guards it |
| --- | --- | --- |
| `repro-preset-item-loss.mjs` | Loadout swap + tab suspend + idle catch-up destroying everything the preset withdrew | `holdingsReconcile` |

## Adding tests

Follow `.claude/rules/testing.md`: bug fix => failing test first in the same PR; new behaviour => test in the same diff; logic that can't be tested where you write it moves to `src/engine`/`functions/_lib`. New CLAUDE.md gameplay invariant (§4-§7) => a matching test in the same change.
