# Step charters

Each step is a mindset switch inside one session. Enter with `step: <name>`; exit with a ≤5-line handoff note (decisions, files touched, open findings). These charters fold the retired `.claude/agents/` squad roster — pointer-heavy on purpose: the domain knowledge lives in CLAUDE.md §s and path-scoped rules, not here.

## Plan (always)

Turn the request into buildable, testable work — from evidence, not memory (read the relevant files first). Emit exactly:

```
GOAL: <one sentence: what is true when this is done>
UNKNOWNS: <each with how it was/will be verified>
SUCCESS CRITERIA: <executable - a command, a test, an observable>
STEPS: <which optional steps run and why; numbered work items, verification included>
EDGE CASES: <player-visible and data-integrity edge cases to cover>
OUT OF SCOPE: <adjacent issues noticed, flagged not fixed>
```

- Gameplay invariants are `.claude/rules/gameplay-engine.md` (engine-wide) plus CLAUDE.md §5–§7 (XP, tick model, special attacks); a plan violating one is defective before any code exists.
- Anything moving value (coins/credits/items/XP grants) must state which side of the §14 boundary each mutation lands on; a **new** boundary crossing → Architect step required.
- New game content → name the `add-content` checklist in the work item rather than restating it.
- Player-visible mechanics change → include `docs/game-guide.md` + `npm run gen:knowledge` as a work item.
- Clarifications: derive answers from the repo first. Ask the user (AskUserQuestion) only for genuine product decisions — naming, pricing, player-facing behaviour choices — where the answer changes the deliverable and cannot be derived. Never block on a question the codebase answers.

## Architect (optional)

Runs when Plan flags `plan-gate` territory: §14 boundary, save format, migration, single-file build pipeline (§12), multi-system or novel design. Settle with file-level specificity BEFORE the first edit:

1. **Ownership boundary (§14)** — every new mutation: server-authoritative (endpoint, server RNG, audit event via `functions/_lib/game/audit.js`) or client-trusted save blob. Never add `/api/save` validation policing economy increases; tighten integrity by moving the reward server-side.
2. **Engine purity** — `src/engine/` stays pure logic, no UI imports; new logic goes there, not in JSX.
3. **Build safety (§12)** — new screens into `sourceFiles` + `GAME_CHUNK_FILES`; no eval-time cross-module reads (TDZ whites out prod); globally unique top-level identifiers.
4. **Data layer** — D1 migration (`migrations/NNNN_name.sql`) for durable server state vs the save blob for client-trusted state; name the table/field each datum lives in.
5. **Sequencing** — migration before endpoint, schema before UI, and any other ordering constraints.

If reality contradicts the request (the asked-for design breaks an invariant), say so and propose the compliant alternative — don't design around it silently.

## Engineer (as needed)

All code, whichever domains the plan touches — one step, no handoffs. Per-domain constraints:

**Engine & content** (`src/engine/**`, `src/data/**`):
- Invariants §4–§7 are load-bearing — verify against them before and after.
- Determinism: same inputs → same outputs; RNG flows through existing patterns, no scattered `Date.now()`/`Math.random()`.
- Content authoring follows `add-content` — invoke it, don't work from memory.
- New logic ships with tests in the same change (`tests/**/*.test.ts`, Vitest, logic-only).
- High-value uniques are granted server-side (§14) — engine code rolls nothing the server owns.

**UI** (`src/screens|components|state|hooks/**`):
- Read `PRODUCT.md` + `DESIGN.md` before player-facing work; player copy uses the product voice.
- Preact + JSX, no React; reuse `src/components/` before new wrappers.
- Tailwind + `:root` vars; no `/N` opacity modifiers; no inline `style={{}}` unless truly dynamic; 44×44px tap targets.
- Branching game logic in a component → stop, extract to `src/engine/` with tests.
- Build registration per §12 (`sourceFiles`, `GAME_CHUNK_FILES`, chunk-data typeof guards).

**Server** (`functions/**`, `migrations/**`):
- Every `/api/*` route verifies the session JWT (`requireAuth`); no unauthenticated mutations.
- High-value grants, purchases, credit debits, PvP settlement: server-authoritative, server RNG, audit events; credits **never** move via `/api/save`; `/api/save` keeps exactly its two guards.
- Durable server state → new migration (next `NNNN`); never in the save blob if the server must trust it.
- Path-scoped rules auto-load (pvp/mcp/chat) — follow them; MCP save-intents route through `applyTaskResult.js`.

Scope-fence applies throughout: flag adjacent issues, never fix them.

## World Designer (as needed)

World and content design decisions: new or updated places (`src/data/world.json`, incl. `teleport` entries — geography stays in core, §12), world activities (`src/data/worldActivities.json` — chunk-loaded, keep the typeof guards), slayer master placement, journey/clue routing (`src/engine/journeys.js`), 3D creature/hero specs (`procgen-creature` — mandatory screenshot review, never commit a spec unseen), and place art direction per `DESIGN.md`/`PRODUCT.md`. Content invariants via `add-content`.

## Code Review (always, after Engineer/World Designer, before QA)

Independent of QA: reviews the diff itself, not the diff against Plan's success criteria. Invoke the `code-review` skill against the working diff at `medium` effort (raise to `high` for §14-boundary or save-format changes). It finds correctness bugs and reuse/simplification/efficiency issues; it does not verify gameplay behaviour or write tests — that's QA.

Verdict: PASS or FAIL with findings ranked by severity, each with file:line and the concrete failure scenario. FAIL → back to the Engineer step to address every finding (fix, or state why not — scope-fence applies: don't fix unrelated issues surfaced along the way), then Code Review again. Loop until PASS before QA starts.

## QA (always)

Adversarial: find where the change is wrong, untested, or invariant-violating — do not confirm it works.

1. Judge the actual diff (`git diff`) against Plan's success criteria, not against what earlier steps concluded.
2. Hunt gaps with `.claude/rules/testing.md` discipline: bug fixes need a test that fails without the fix; gameplay logic changes need logic tests in the same diff; no mirror-list/source-regex tests; logic buried in JSX is a finding.
3. Check the invariants the change grazes: §4–§7 math, §12 build safety (screens registered? TDZ-safe?), §14 boundary (value mutations client-side that should be server-side? credits outside the three legal endpoints?).
4. Write the missing regression tests (`tests/**/*.test.ts`, Vitest, logic-only).
5. **Visual gate** for player-visible changes: 3D specs → `scripts/render-proc.mjs` / `render-arena-hero.mjs`; UI changes → where the environment provides Chromium/Playwright (cloud sessions do), drive the built app and screenshot the changed surface at a mobile viewport; otherwise state that the visual check was skipped and why.
6. Run the gate: `npm test` always; `npm run ci` before commit.

Verdict: PASS or FAIL, findings ranked by severity — each with file:line, the concrete failure scenario, and whether a new test covers it. A green suite with an uncovered failure scenario is a FAIL. FAIL → Engineer step fixes → QA re-runs.
