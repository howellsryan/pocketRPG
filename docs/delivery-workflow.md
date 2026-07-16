# Delivery Workflow — single-agent stepped delivery

Every implementation task is delivered by **one agent** (the session itself) moving through dedicated steps — Plan → optional Architect → Engineer / World Designer → QA — instead of spawning a squad of role agents. This doc is the design record; the operational protocol lives in the `delivery-loop` skill (`.claude/skills/delivery-loop/`, step charters in its `steps.md`).

Supersedes the squad workflow (2026-07-16; previous design record `docs/squad-workflow.md`, in git history). The squad's output quality was good; its token bill was not.

## Why single-agent (research inputs)

- **[Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)**: multi-agent systems burn ~15× the tokens of a chat, and pay off only when the task decomposes into *independent parallel directions* whose value covers the cost (breadth-first research). "Domains that require all agents to share the same context or involve many dependencies between agents are not a good fit." Sequential build work on one repo — plan, design, code, test against the same files — is exactly that bad fit.
- **[Cognition — Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents)**: a single-threaded agent with continuous context beats dispersed decision-making; splitting a build across agents is a game of telephone where constraints get lost in handoff. Their durable middle ground: extra agents may *contribute intelligence* (read-only research), but **writes stay single-threaded**.
- **Measured multipliers** ([UIUC study via Augment Code](https://www.augmentcode.com/guides/single-agent-vs-multi-agent-ai), [Cognilium](https://cognilium.ai/blogs/multi-agent-vs-single-agent)): multi-agent setups consume 4–220× the tokens of a single agent; at equal token budgets a single agent matches or beats multi-agent on dependent reasoning. Default guidance across sources: one capable agent with good tools and memory; multiple only for true parallelism or walled-off context.

Our own experience matched: each squad spawn re-loaded CLAUDE.md and path rules cold, re-read files already in the lead's context, and re-briefed constraints through role prompts — duplicated intake several times per task, for work that was never parallel in practice (builders waited on the architect, QA waited on builders).

## What the steps keep from the squad

The squad's quality came from **role discipline**, not from process isolation — and discipline transfers to steps for free:

| Squad role | Now | What survives |
|---|---|---|
| `technical-ba` | **Plan** step (always) | Evidence-first breakdown, executable acceptance criteria, edge cases, §14 boundary call-outs |
| `architect` | **Architect** step (optional) | File-level ownership/sequencing decisions before edits, gated to plan-gate territory |
| `gameplay-engineer` / `frontend-designer` / `backend-developer` | **Engineer** step (one step, all code) | Each domain's hard constraints, folded into per-domain sections of the charter |
| — (was spread across roles) | **World Designer** step (optional) | World/place/activity/3D-spec design as a named discipline |
| `senior-qa` | **QA** step (always) | Adversarial framing, diff-vs-criteria judgment, regression tests, the §11 gate, plus a visual gate (render scripts / Playwright screenshots) |

New mechanics that replace inter-agent plumbing:

- **Step announcements** (`step: plan`) make the discipline auditable without report ceremony.
- **≤5-line handoff notes** per step replace cross-agent reports and survive context compaction.
- **Triage stays**: a `checklist` fast-path skips the loop for work an existing checklist already covers — the loop is for real features, not typo fixes.
- **QA independence by framing**: QA judges the raw diff against Plan's written success criteria, not earlier steps' conclusions. Weaker than a cold reviewer, but the written criteria + adversarial charter recover most of it.

## The one sanctioned subagent

Read-only **Explore**-type fan-out searches remain allowed: they move file dumps *out* of the main context and return conclusions, so they reduce net tokens — the Cognition "contribute intelligence, single-threaded writes" pattern. Nothing that edits files is ever spawned. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is removed from `.claude/settings.json`; the `.claude/agents/` roster is deleted (charters folded into `delivery-loop/steps.md`).

## Risks / accepted trade-offs

- **Lost reviewer independence**: squad QA started cold and couldn't inherit the builder's blind spots. Mitigation: adversarial QA charter + judging the diff against pre-written executable criteria. If quality regresses, the cheap escalation is a *single* cold QA re-review on demand — not a standing squad.
- **Lost parallelism**: real, but squad builds rarely parallelised in practice (dependency chains); Anthropic's data says we were paying the multiplier without the parallel payoff.
- **Long tasks compact context**: mitigated by handoff notes and the plan block, which are re-derivable anchors after summarization.
- **No committed UI screenshot harness yet**: QA's Playwright check is ad hoc (cloud sessions ship Chromium). Follow-up below.

## Rollout

1. This change: `delivery-loop` skill + step charters, CLAUDE.md/SKILLS.md rewiring, squad artifacts removed (one PR).
2. Next few stepped tasks: watch for skipped steps (Plan/QA are non-optional), over-triage to `checklist`, and handoff-note quality.
3. Later, if warranted: a committed Playwright screenshot script for UI QA; a `TaskCompleted`-style hook enforcing `npm run ci` mechanically.
