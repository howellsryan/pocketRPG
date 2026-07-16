---
name: delivery-loop
description: Use at the START of every implementation task, before the first edit - runs the single-agent stepped delivery workflow: triage (checklist vs stepped), then Plan, optional Architect, Engineer / World Designer as needed, QA - all inside this one session, spawning no builder/QA agents. Do not use for pure questions or research, and do not re-invoke mid-task once the loop has started.
---

# delivery-loop: one agent, dedicated steps

All delivery happens in this session. Roles are **steps you switch between**, not agents you spawn: steps share one continuous context, so nothing is re-read, re-briefed, or lost in handoff — the discipline of the old squad roles at a fraction of the tokens. Design record + research: `docs/delivery-workflow.md`.

**No delivery subagents.** Do not spawn builder/QA/BA/architect agents; harness defaults reserving spawns for explicit user requests apply in full. One sanctioned exception: read-only **Explore**-type agents for broad fan-out searches — they keep file dumps out of this context, reducing tokens rather than multiplying them. Writes stay in this session, always.

## Triage first

State the tier and a one-line reason, then act:

- **`delivery-loop: checklist`** — one file/domain with an obvious test, or work an existing checklist fully covers (content via `add-content`, doc edits, copy tweaks, config). Skip the loop; apply the checklist and the §11 gate.
- **`delivery-loop: stepped`** — everything else. Run the loop below.

When in doubt, start checklist and escalate the moment the task surprises you — same stop-and-replan rule as `plan-gate`.

## The loop (stepped tier)

Read `steps.md` (this skill's directory) once for the step charters. Announce each step on one line (`step: plan`) as you enter it. Steps run in order; optional steps run only when Plan calls them:

1. **Plan** (always) — the BA work: resolve unknowns from repo evidence, emit the plan block naming which optional steps run and why. Ask the user only for genuine product decisions the repo cannot answer.
2. **Architect** (optional) — required when the work trips `plan-gate` territory: §14 integrity boundary, save format, migrations, single-file build pipeline, multi-system or novel design. Settles ownership boundaries and sequencing before any edit.
3. **Engineer** (as needed) — all code: engine, UI, server. One step, no frontend/backend handoffs.
4. **World Designer** (as needed) — world/content design: places, map, activities, 3D specs, place art direction.
5. **QA** (always) — adversarial verification of the diff against Plan's success criteria; missing regression tests written here; visual check for player-visible changes; the §11 gate.

End every step with a **≤5-line handoff note** (decisions made, files touched, open findings). Later steps — and post-compaction context — rely on these notes instead of re-reading.

QA FAIL → back to the Engineer step, then QA again. After QA passes: commit and write the PR (`pr-changelog`).
