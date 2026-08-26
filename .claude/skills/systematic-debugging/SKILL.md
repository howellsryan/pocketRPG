---
name: systematic-debugging
description: Use when any technical issue needs diagnosis - a failing test, a bundle that throws at eval time, a tick loop drifting, a co-op or world session desyncing, a save rejected by /api/save, an item or drop not appearing, an MCP tool returning the wrong shape. Forces root cause before any fix, and stops the guess-and-check loop after three failed attempts. Do not use when building a feature that is not yet broken.
---

# systematic-debugging: root cause before fix

A symptom fix is a failure, not a partial success. This skill is the process that stops "try something and see" from becoming the debugging strategy.

## The iron law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you have not completed phase 1, you may not propose a fix.

## Phase 1 — Investigate

Read the entire error, not the first line: stack trace, line numbers, the thrown type. Reproduce it consistently — if you cannot, that is data to gather, not a licence to guess. Check what changed (`git diff`, recent migrations, a new item in `src/data/`).

Then, **before proposing anything, instrument the boundaries.** This is a layered system and bugs live at the seams far more often than inside a box. The seams worth logging here, roughly in order of how often they hide things:

- **engine ↔ UI** — `src/engine/` is pure logic with no UI imports; a wrong number on screen is either the engine computing it wrong or `gameState.jsx` wiring it wrong, and those are different bugs.
- **client ↔ server** — what the client sent versus what `functions/api/**` authorised. §14 decides which side owns the value; check that before assuming either is wrong.
- **save blob ↔ D1** — what was written, what came back, and which of the three `/api/save` guards (stale-write, total-level regression, bank-wipe) fired.
- **engine ↔ session copy of state** — the world pins `player.specialEnergy` onto engine state each tick (`pinSpecialToSession`) precisely because the shared engine resets its own. Any "value keeps resetting" bug lives here.
- **Durable Object ↔ member clients** — for co-op and raids, log the broadcast and each member's applied state separately.
- **source ↔ generated bundle** — `build_single.cjs` concatenates; a symptom that exists in `index.html` but not in `src/**` is a build-order problem, not a logic one.

One run showing *which* hop breaks beats three speculative fixes.

## Phase 2 — Compare

Find working code doing the same thing in the same repo and list every difference. A monster that drops nothing next to one that drops correctly; a place that renders next to one that does not. "That cannot matter" is exactly how the difference that mattered gets skipped — the two-skin trap in `DESIGN.md` §2 is a standing example, where a neighbouring rule looks like a colour template and is not.

## Phase 3 — Hypothesise

State it in one sentence: "X is the root cause because Y." Test with the smallest possible change, one variable at a time. If it does not work, form a **new** hypothesis — never stack a second fix on top of the first.

## Phase 4 — Fix

Write the failing test first. `src/engine/` is pure and deterministic and `tests/**/*.test.ts` is logic-only, so nearly every engine bug is expressible as a test: write it, watch it fail, then fix, then watch it pass. `TESTING.md` maps feature to test file. One fix, no "while I am here" (`scope-fence`), then verify with evidence (`verification-before-completion`) and the §11 gate.

## The three-fix circuit breaker

Count your attempts. This is the rule most worth keeping.

- **Fewer than 3 failed fixes** → return to phase 1 with what you just learned.
- **3 or more** → **stop. Do not attempt fix #4.** Three failures where each one reveals a new problem somewhere else is not a run of bad hypotheses, it is a wrong architecture. Say so, and put the architectural question to the user before editing anything else.

The signature: each fix works locally and breaks something adjacent, and the next one starts requiring "just a small refactor" of something you were not asked to touch.

## Repo-specific traps

- **A bundle that throws at eval time is a build-order bug, not a logic bug.** TDZ traps are covered by `.claude/rules/single-file-build.md`; `npm run check:single` is the probe. Do not debug it by reading `src/**` alone — the failure only exists in the concatenated output.
- **"The special energy keeps resetting" is by design in the world.** The open world deliberately diverges from the per-fight model (§7): energy is a persistent session resource, regenerating only on the clock. Do not "fix" it back.
- **"Empty" is `energy < 1`, not `=== 0`.** The world carries fractional energy from its 0.2/tick regen, so an exact-zero check fires approximately never out there (§7).
- **A missing drop is usually a missing item, a missing collection-log slot, or the wrong authority side.** Work `add-content`'s checklist before debugging the roll itself; a high-value unique is server-authoritative (§14) and is not the client's to grant.
- **A DPS number that disagrees with the fight is drift between `dpsCalculator.js` and `combat.js`** (§6). `tests/dpsCalculator.test.ts` pins them; if it passes and the numbers still disagree, the unmodelled cases (enchanted bolts, Dharok's scaling, specials) are declared in the payload `notes`.
- **Do not debug an economy anomaly by adding an `/api/save` check.** §14 is explicit: tighten integrity by moving the reward onto a server-authoritative endpoint, never by policing the save blob.

## Flakes

"Flake" is not a root cause. Re-run **once** — only to confirm a failure naming infrastructure the diff does not touch, or one that died before any test body ran. A second failure is real. **Never skip, disable, or quarantine a test to get green.** The engine is deterministic by design; a nondeterministic engine test is a bug in the test or in the determinism, and either way it is yours.

## Red flags — stop and return to phase 1

- "Quick fix now, investigate later" · "just try changing X and see"
- Proposing a fix before tracing where the bad value entered the system
- "It is probably the tick loop" — probably is not a root cause
- Several changes at once, so you cannot tell which one worked
- "One more attempt" when you have already tried two
