---
name: verification-before-completion
description: Use before claiming any work is done, fixed, working, or passing - and before every commit, PR, or handoff back to the user. Requires fresh evidence from an actual run rather than inference from the code reading correctly. Do not use as a substitute for the delivery-loop QA step or the §11 gate; this is the evidence standard those have to meet.
---

# verification-before-completion: evidence before claims

## The iron law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

Before writing "works", "fixed", "passing", "done", or any paraphrase of them: **identify** what would prove it → **run it** fully, now, against the current code → **read** the whole output and the exit code → **confirm** it supports the specific claim → **then** claim it, naming what you ran.

A claim you inferred rather than observed is a guess in a confident voice.

## The gate is necessary, not sufficient

`npm run ci` is typecheck + build (which runs the full Vitest suite via `prebuild`) + rebuild + `gen:guide` + `check:single` + the two preview checks. It proves the code compiles, the logic tests hold, and the bundle does not throw at eval time.

It proves **nothing** about whether the player sees the right thing. There is no UI test layer: `tests/**` is logic-only by design.

| Claim | What actually proves it |
|---|---|
| "It builds and the suite passes" | `npm run ci`, exit 0, just now |
| "The behaviour is right" | A test that **failed before** your change and passes now |
| "The bundle is safe" | `npm run check:single` — duplicate-identifier, syntax, and the eval-time TDZ smoke run |
| "The screen looks right" | A screenshot at a real mobile viewport, looked at |
| "The animation reads correctly" | Watching it, at the action's real cadence — `action-animation` |
| "The 3D spec renders" | `scripts/render-proc.mjs`, screenshot reviewed — mandatory per `procgen-creature` |
| "The drop works" | The item exists in `items.json`, the collection-log slot exists, and the regression test covers it — `add-content` |
| "Co-op settles correctly" | Two members, a kill, and the payout observed — not one client's view of it |

## Verify the transition, not the end state

A fix is verified when you have watched it go from failing to passing:

1. Reproduce the failure and **see it fail**.
2. Apply the fix.
3. See it pass.

Step 1 is the one that gets skipped, and skipping it is how you ship a change that fixed nothing because the bug was somewhere else. For `src/engine/` this is cheap and there is no excuse — the engine is pure, deterministic, and already covered by `tests/`.

## Player-visible changes need a look

If the change alters anything a player sees — a screen, a number, an animation, an item icon, a reward card — a green `npm run ci` is not evidence. Look at it. `DESIGN.md` §2's two-skin trap means a rule that reads correctly in isolation can render wrong under `.forge-shell`, and no automated check in this repo will catch that.

## Red flags in your own writing

- "should work now" · "should be fixed" · "probably fine"
- "I have made the change, it looks correct"
- "the logic is right, so it will render"
- "this matches the pattern in the neighbouring screen" (see the two-skin trap)
- Any completion claim where you cannot name the command you ran
- Quoting a run made *before* your most recent edit
- Treating a subagent's report as verification — Explore returns findings, not proof

## Report both halves

State what you verified and what you did not:

```
Verified: npm run ci (exit 0); Armoury screen at 390x844, screenshot checked,
skill-cape filter lists correctly.
Not verified: the Wilderness variant of this path; iOS build untouched but
unexercised.
```

If a check failed, say so with the output. If you skipped a step, name it. An honest "I could not verify X" is worth more than a confident claim the next session discovers was wrong — and §17's brevity rules never license dropping the "not verified" half.
