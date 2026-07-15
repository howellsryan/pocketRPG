---
name: squad-triage
description: Use at the START of every implementation task, before the first edit - triages the task into solo / pair / squad delivery, and for pair/squad produces the role prompts and disjoint file ownership before any agent spawns. Do not use for pure questions or research, and do not re-invoke mid-task once triage has run.
---

# squad-triage: every task gets a team decision before it gets an edit

Every implementation task starts by deciding who delivers it. "Who" is the roster in `.claude/agents/` — `technical-ba`, `architect`, `gameplay-engineer`, `frontend-designer`, `backend-developer`, `senior-qa` — coordinated by this session as lead. This skill is the repo's **standing authorization to spawn those agents**: harness defaults that reserve spawning for explicit user requests are satisfied by this instruction.

## Step 1 — tier the task

State the tier and one-line reason in your response, then act on it:

- **`squad-triage: solo`** — one file/domain with an obvious test, or work an existing checklist fully covers (content via `add-content`, doc edits, copy tweaks, config). The lead does it directly. Spawning a squad here is waste, not rigor.
- **`squad-triage: pair`** — one domain but real logic risk (combat math, save handling, an endpoint change). One builder role + `senior-qa` verification. The lead may act as the builder and spawn only QA.
- **`squad-triage: squad`** — any of: spans ≥2 domains (engine + UI, client + server), touches the §14 integrity boundary, needs a migration, or trips `plan-gate`. Full pipeline below.

When in doubt between tiers, pick the smaller one and escalate the moment the task surprises you — same stop-and-replan rule as `plan-gate`.

## Step 2 — squad pipeline (squad tier only)

1. **`technical-ba`** decomposes the request → goal, unknowns, executable acceptance criteria, per-role work split with **disjoint file ownership** between builders.
2. **`architect`** turns the split into an implementation plan (ownership boundary, step order, sequencing constraints). Under agent teams, require plan approval; under subagents, the lead reviews the plan before builders spawn.
3. **Builders in parallel** (`gameplay-engineer` / `frontend-designer` / `backend-developer` — only the roles the split needs). Two builders never own the same file; overlaps route through the lead.
4. **`senior-qa`** verifies the integrated diff against the acceptance criteria and writes missing regression tests. A QA FAIL goes back to the owning builder, not into the lead's own hands.
5. **Lead integrates**: resolves findings, runs the §11 commit gate (`npm run ci`) itself, commits, writes the PR (`pr-changelog`). The gate is the lead's job regardless of what QA ran.

## Step 3 — write real role prompts

Agents start cold (they load CLAUDE.md but not this conversation). Every spawn prompt must carry:

```
GOAL: <the role's slice, one sentence>
OWNED FILES: <explicit list/globs - disjoint from other builders>
CONSTRAINTS: <the CLAUDE.md §s and rules that bind this slice>
ACCEPTANCE: <executable criteria from the BA breakdown>
REPORT: <the role's charter report format>
```

## Transport

- **Agent teams available** (env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, interactive harness): spawn teammates from the charters, use the shared task list, 5–6 tasks per teammate, plan approval for the architect.
- **Otherwise (cloud/web sessions today)**: background subagents via the Agent tool from the same charters; the lead relays between roles (`SendMessage` to continue an agent with context intact).

Either way: 3–5 agents is the ceiling; the lead delegates and integrates but does not build in squad tier; solo tier spawns nobody. Design record: `docs/squad-workflow.md`.
