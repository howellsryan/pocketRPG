# PocketRPG — Technical Review & 2-Day Backlog

> **Reviewer:** Principal engineer / architect pass over `src/engine`, `src/state`, `src/screens`, `functions/`, and `tests/`.
> **Date:** 2026-06-21
> **Branch reviewed:** `claude/rpg-game-codebase-review-n2ck54` (at `dcdfa70`)
> **Baseline health:** `npm run test:logic` → **1728 tests across 129 files, all passing.** No skipped/`.only`/`.todo` tests. No P0 (crash/data-loss/exploit) defects were found. The items below are ranked **P1** (must-fix correctness/consistency) and **Tech Debt / Coverage**.

This is sized as a two-day backlog. Each item is **independent** and ordered roughly by value-to-effort. Stick to the commit gate (`npm test && npm run build && npm run rebuild && npm run check:single`) for anything that touches `src/**`.

---

## Summary table

| # | Title | Type | Priority | Est. | Status |
|---|-------|------|----------|------|--------|
| 1 | Thieving has a 100% success rate (no failure/stun mechanic) | Correctness / balance | P1 | 0.5d | ⏸️ Deferred (balance change — needs product tuning) |
| 2 | Combat-level formula is copy-pasted in 3 places and has diverged | Correctness / tech debt | P1 | 0.5d | ✅ Done |
| 3 | `activityRegistry.js` (progress-persistence routing) is completely untested | Test coverage | P1 | 0.5d | ✅ Done |
| 4 | `quests.js` eligibility + idle-sim logic is untested (and used by MCP) | Test coverage | P1 | 0.5d | ✅ Done |
| 5 | `gatherTasks.js` / `construction.js` / `clueScrolls.js` / `activitySession.js` untested | Test coverage | P2 | 0.5d | ✅ Done (+ found & fixed an invalid master-clue item: `torstol` → `thornspire`, its faithful renamed successor) |
| 6 | `CombatScreen.jsx` is a 3,195-line monolith | Tech debt / maintainability | P2 | 1d (scoped) | ✅ Done (scoped: content gates extracted + 14 tests) |
| 7 | Stale planning docs vs. shipped behavior (idle-robustness, feature-plan) | Doc debt | P2 | 0.25d | ✅ Done |

> Item 1 is the only one deferred, by request — it changes game balance/economy
> and wants product input on the failure-rate curve before implementation.

---

## 1. Thieving has a 100% success rate (no failure/stun mechanic)

**Type:** Correctness / gameplay balance · **Priority:** P1

### Problem
`src/engine/thieving.js` never rolls for failure. Both the live tick and the idle
simulation award the full reward on every pickpocket:

- `processThievingTick()` (`src/engine/thieving.js:48-65`) always pushes a
  `pickpocketSuccess` event once `ticksRemaining <= 0`. There is no
  `pickpocketFailure` branch, no damage, and no stun.
- `simulateIdleThieving()` (`thieving.js:74-101`) computes
  `actions = floor(totalTicks / ticksPerAction)` and pays out **every** action.
- The code openly flags this: `// TODO: Implement proper PocketRPG success rates in future` (`thieving.js:53`).

Effect: Thieving (including Master Farmer seed farming, which feeds the farming
economy) yields strictly more XP/coins/seeds per hour than intended, with zero
risk. Because idle catch-up uses the same path, this also inflates offline gains.
The `pickpocketFailure` event type is even documented in the function's JSDoc
(`thieving.js:31-33`) but never emitted — so the UI failure path is dead.

### Solution
1. Add a level-scaled success-rate function in `src/engine/thieving.js`
   (e.g. `getPickpocketSuccessRate(npcLevelOrChance, thievingLevel)`), driven by
   per-NPC data in the thieving data file rather than a hardcoded constant.
2. In `processThievingTick()`, on completion roll `Math.random()` against the
   rate; on failure emit `{ type: 'pickpocketFailure', npcName, damage }` and
   skip the reward (optionally apply a short stun by extending `ticksRemaining`).
3. In `simulateIdleThieving()`, multiply rewards by the expected success rate
   (`floor(actions * successRate)`) so idle and live stay consistent —
   deterministic expectation, no per-action RNG in the offline path.
4. Wire the existing `pickpocketFailure` event into `ThievingScreen.jsx` (toast +
   any hit-splat) so the UI reflects failures.

### Acceptance criteria
- [ ] A new `tests/thieving.test.ts` (extend existing) asserts: low-level player
      vs. high-level NPC fails some % of the time; high-level player vs. low NPC
      approaches but never exceeds 100%.
- [ ] Idle XP/coins/seeds for a fixed window scale down by the success rate vs.
      the current always-succeed numbers (regression test pins the new expected value).
- [ ] `pickpocketFailure` events are emitted and surfaced in the UI.
- [ ] The `TODO` at `thieving.js:53` is removed.
- [ ] Commit gate passes.

---

## 2. Combat-level formula is copy-pasted in 3 places and has diverged

**Type:** Correctness / tech debt · **Priority:** P1

### Problem
The combat-level computation exists as **three independent copies**:

| Location | Function | Notes |
|----------|----------|-------|
| `src/utils/helpers.js:108` | `calcCombatLevel(stats)` | takes raw levels; **no** `Math.max(3, …)` floor |
| `src/engine/quests.js:36` | `getCombatLevel(stats)` | takes `stats[skill].xp`; **no** `Math.max(3, …)` floor |
| `functions/_lib/combatLevel.js:11` | `getCombatLevelFromSave(save)` | server-authoritative; **has** `Math.max(3, …)` |

The numeric core matches (the `floor(ranged*1.5)` vs `floor(ranged/2)+ranged`
forms are mathematically equal), **but the minimum floor diverges**: the two
client copies can report a combat level of **1 or 2** for a fresh/low account,
while the server clamps to **3**. `quests.js#getCombatLevel` is consumed by the
MCP quest-eligibility path (`functions/_lib/mcp/intents.js:1331,1507,1541`), so a
combat-level quest requirement can be evaluated against a different number than
the server would compute, and the PvP ±10 matchmaking band the client *displays*
can disagree with the server's snapshot at the low end.

Beyond the live divergence, three hand-maintained copies of a balance-critical
formula is a guaranteed future-drift hazard.

### Solution
1. Create one canonical, dependency-light helper (e.g.
   `src/engine/combatLevel.js`) exporting `combatLevelFromLevels(levels)` and
   `combatLevelFromStats(stats)` — pure, no Preact/JSX imports so Pages Functions
   can import it directly.
2. Apply the `Math.max(3, …)` floor in the canonical version (matches OSRS and
   the server).
3. Replace all three call sites to delegate to the shared helper. Keep
   `functions/_lib/combatLevel.js` as a thin re-export if the "no JSX transitive
   import" constraint still holds (verify the new module pulls nothing UI-bound).

### Acceptance criteria
- [ ] Exactly one implementation of the formula remains; the other two delegate.
- [ ] `tests/combatLevel.test.ts` asserts client and server return **identical**
      values across a matrix including all-level-1 (expect 3), pure-mage, pure-range,
      and maxed accounts.
- [ ] Existing `combatLevel.test.ts` / `combatInfoSheets` / `pvpMatchBuild` tests pass unchanged.
- [ ] Commit gate passes.

---

## 3. `activityRegistry.js` — progress-persistence routing — is completely untested

**Type:** Test coverage · **Priority:** P1

### Problem
`src/engine/activityRegistry.js` is the single source of truth for **whether a
player's in-progress activity is preserved or wiped** when they navigate or
background the app — the exact behavior the idle-robustness work set out to fix.
It drives:

- `isBackground()` → `App.jsx` `navigate()` (`src/App.jsx:1480`) decides flee-vs-keep.
- `getActivityKey()` → `gameState.jsx` `setActiveTask` (`src/state/gameState.jsx:681-689`)
  flushes the outgoing activity's partial progress into the per-activity ledger.
- `getActivityKey()` is also used by `QuestsScreen.jsx:52` and `MinigamesScreen.jsx:24`
  to read progress back.

Despite governing data-loss-class behavior, the module has **zero tests**. A
regression where `getActivityKey` returns a colliding or `null` key, or
`isBackground` misclassifies a `type`, would silently wipe player progress — the
original bug, reintroduced with no test to catch it.

### Solution
Add `tests/activityRegistry.test.ts`:
- `isBackground` is `true` for every background type (`quest`, `minigame`, `clue`,
  `gather`, `agility`, `thieving`, `hunter`, `skill`) and `false`/null for
  `combat` and unknown/`undefined`.
- `getActivityKey` returns a **stable, unique, non-null** key for each background
  task shape, and `null` for `combat`/unknown.
- Two *different* activities never collide on the same key; the *same* activity
  (same ids) always produces the same key (so the ledger flush in
  `setActiveTask` at `gameState.jsx:682` correctly detects "same vs. switched").
- The dungeoneering special-case (`skill` + `task.skill === 'dungeoneering'`,
  `activityRegistry.js:61`) produces a distinct key namespace.

### Acceptance criteria
- [ ] New test file covers all branches of `isBackground` and `getActivityKey`.
- [ ] Branch coverage of `activityRegistry.js` is 100%.
- [ ] Commit gate passes.

---

## 4. `quests.js` eligibility + idle-sim logic is untested

**Type:** Test coverage · **Priority:** P1

### Problem
`src/engine/quests.js` (166 lines) has **no direct test** yet exports logic used
on real reward/eligibility paths, including from the server-side MCP:

- `checkQuestEligibility()` (`quests.js:58`) — gates quest starts; consumed by
  `functions/_lib/mcp/intents.js`.
- `getQuestPointsEarned()`, `simulateIdleQuest()` (`quests.js:135`),
  `processQuestTick()` (`quests.js:117`).

Quests are a background-persistent activity (item 3), so a bug in
`simulateIdleQuest` or `processQuestTick` directly affects offline progress
correctness.

### Solution
Add `tests/quests.test.ts` covering:
- `checkQuestEligibility` returns `{eligible:false, reasons:[…]}` for unmet
  skill/combat/quest-point/prerequisite requirements and `{eligible:true}` when met.
- `getQuestPointsEarned` sums points only for completed quest ids.
- `processQuestTick` / `simulateIdleQuest` advance and complete correctly,
  including the `elapsedMs → actions` boundary (0 actions when below one tick).

### Acceptance criteria
- [ ] All exported functions in `quests.js` have at least one positive and one
      negative/edge case.
- [ ] Eligibility test matrix matches what the MCP `start_quest`/`queue_quest`
      path enforces.
- [ ] Commit gate passes.

---

## 5. Round out untested engine modules

**Type:** Test coverage · **Priority:** P2

### Problem
The following pure-logic engine modules have no direct test importing them:

- `src/engine/gatherTasks.js` (210 lines) — `GATHER_TASKS` table + `findGatherTask`.
  Data integrity (level reqs, ids, drop refs) and lookup are unverified.
- `src/engine/construction.js` (37 lines) — `BUILDING_ACTIONS`, `UNLOCKABLES`,
  `findBuildingAction`, `findConstructionPerk`.
- `src/engine/clueScrolls.js` (42 lines).
- `src/engine/activitySession.js` (63 lines) — session tally + `ratePerHour`
  (guards a divide-by-elapsed; worth pinning the `elapsed <= 5000 → null` guard).

### Solution
Add lightweight data-contract + behavior tests:
- `gatherTasks`: every task has a unique `id`, valid skill, monotonic level reqs,
  and every referenced item exists in `src/data/items.json` (mirror the existing
  `data-contracts.test.ts` style).
- `construction`: lookups return the right entry / `undefined` for unknown ids.
- `activitySession`: `mergeSession` accumulates each field; `ratePerHour` returns
  `null` under the 5s guard and a correct whole-number rate above it.

### Acceptance criteria
- [ ] One test file per module (or grouped), each module imported and exercised.
- [ ] `gatherTasks` item-reference contract test fails if a task references a
      missing item id.
- [ ] Commit gate passes.

---

## 6. `CombatScreen.jsx` is a 3,195-line monolith

**Type:** Tech debt / maintainability · **Priority:** P2

### Problem
`src/screens/CombatScreen.jsx` is **3,195 lines** — by far the largest file in the
repo (next screen is `PvpCombatScreen.jsx` at 1,048). It mixes tick orchestration,
prayer/special-attack UI state, loot-modal handling, and rendering. This is the
highest-churn area of the codebase (it appears in a large share of recent commits:
restore-potion timers, prayer drain, combo food, hit-splats, modal layout). Size +
churn = the most likely place for a regression, and it has no component-level test
seam because logic and JSX are entangled.

### Solution (scoped — do **not** attempt a full rewrite in 2 days)
Extract **pure, testable** units without changing behavior:
1. Move tick/derived-state helpers (timers, special-energy math, prayer-pool
   readouts) into `src/engine`-adjacent pure functions or a `useCombatTick` hook
   that takes inputs and returns values — no JSX.
2. Split the loot/result modal and the quick-actions panel into existing
   `src/components/` patterns (note the build constraint: any new shared component
   must be registered in `build_single.cjs` `sourceFiles`, and CombatScreen stays
   in `GAME_CHUNK_FILES`).
3. Add a unit test against the extracted pure helpers.

Keep this a refactor-behind-tests: extract one or two units, prove behavior is
unchanged, stop. Treat the rest as a follow-up.

### Acceptance criteria
- [ ] At least the combat-timer/special-energy/prayer-pool math is extracted into
      a pure module with its own test.
- [ ] `CombatScreen.jsx` shrinks measurably with **no** behavioral diff
      (manual smoke per `/run` or the `verify` skill on a fight + special + loot).
- [ ] `npm run check:single` still passes (no duplicate top-level identifiers
      across core + game chunk).
- [ ] Commit gate passes.

---

## 7. Stale planning docs vs. shipped behavior

**Type:** Documentation debt · **Priority:** P2

### Problem
Several `docs/*.md` planning files describe work as "not done" that has since
shipped, which misleads future contributors (and agents):

- `docs/idle-robustness-plan.md` still says *"No code changes yet"* and describes
  the "wipe-on-navigate" bug as live — but `navigate()` now uses
  `isBackground(activeTask)` (`src/App.jsx:1480`) and the per-activity ledger is
  wired via `getActivityKey` (`src/state/gameState.jsx:681`). The
  server-authoritative idle claim also appears implemented
  (`tests/idleClaimAuthority.test.ts`).
- `docs/feature-plan-2026-06.md` "Feature 1 — Bank tab ordering is broken" is
  implemented (backfill at `src/state/gameState.jsx:421`, first-insert ordering at
  `:600`).

CLAUDE.md §13 explicitly asks that guides be updated in the same change as the
behavior — these slipped.

### Solution
Update each doc's status header to reflect shipped state (or move to a
`docs/done/` / archive), with a one-line pointer to the implementing code. Don't
delete design rationale; just correct the "Status".

### Acceptance criteria
- [ ] `idle-robustness-plan.md` and `feature-plan-2026-06.md` no longer claim
      shipped work is pending; each notes the implementing file(s).
- [ ] No code changes required.

---

## Notes / explicitly **not** flagged

- **Client-authoritative economy** (XP/coins/idle loot computed client-side) is
  **by design** per CLAUDE.md §14 — not a bug. Do not add `/api/save` anti-cheat
  guards for economy increases.
- **PvP/idle `Math.random` usage** is acceptable: the server owns the PvP tick and
  determinism is via tick + character-id *ordering*, not RNG seeding.
- **`Math.round` in `agility.js` / `seedDrops.js` / `activitySession.js`** is for
  timing/probability-display, not gameplay XP/loot rounding, so it does not
  violate the `Math.floor` invariant (CLAUDE.md §4).
</content>
</invoke>
