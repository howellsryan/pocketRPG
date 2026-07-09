---
name: plan-gate
description: Use before starting novel or multi-system work - anything spanning engine + server + migration together, touching the §14 integrity boundary (auth, grants, credits, purchases, /api/save guards), the save format, PvP settlement, or the single-file build pipeline. Forces a short written plan (goal, unknowns, success criteria, step order) BEFORE the first change. Do NOT use for routine work an existing checklist already covers - content/data authoring, single-area fixes, UI tweaks, doc edits - or for pure questions.
---

# plan-gate: no edits until the plan exists

The most expensive failure mode in agentic work is not a wrong answer. It is discovering the real shape of the task halfway through changing things. This gate makes that discovery happen BEFORE anything changes, when it costs nothing. It is deliberately narrow: routine PocketRPG work (add a drop, fix a screen, tweak a formula) has checklists in CLAUDE.md and skills — writing a plan for those is ceremony, not safety.

## The gate

Before your first edit, write a plan in your response. Not in your head:

```
GOAL: <one sentence: what is true when this is done>
UNKNOWNS: <what you have not verified yet - each with how you will verify it>
SUCCESS CRITERIA: <how you and the user will KNOW it worked - a command, a test, an observable>
STEPS: <numbered, smallest useful granularity, verification steps included>
OUT OF SCOPE: <adjacent things you noticed but will NOT touch>
```

Rules:
1. **The plan comes from evidence, not memory.** Read the relevant files and run the relevant read-only commands FIRST. A plan written before looking is a guess with formatting.
2. **Every unknown gets a verification step.** "Probably X" is not a plan line. "Check whether X by doing Y" is.
3. **Success criteria must be executable.** "Code works" fails this test. "npm test passes and the new migration applies cleanly" passes it.
4. **More than 7 steps → the task needs decomposition**, not a longer plan. Split it and gate each part.
5. **When reality contradicts the plan mid-task, STOP and re-plan.** Do not improvise past a surprise. State what changed, update the plan, continue. This rule applies to ALL tasks, even ones that skipped the gate.

## What this catches

- The hidden dependency you would have found at step 4 with three files half-edited.
- The missing success criterion that lets you declare victory on broken work.
- The pivot cascade: three abandoned half-approaches in one session because none was planned.

## Deciding whether the gate applies

Gate it: new server-authoritative endpoint; anything moving value (coins/credits/items) across the client/server boundary; save-format or migration changes; changes to `build_single.cjs` chunking; cross-cutting refactors. Skip it: work covered by `add-content`, `pr-changelog`, §7-§9 checklists, single-file fixes with an obvious test. When you skip on a judgment call, say "skipping plan-gate: routine" so the skip is a decision, not a lapse — and the moment a "routine" task surprises you, stop and write the plan.
