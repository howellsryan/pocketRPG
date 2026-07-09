# SKILLS.md — Agent Configuration Reference

The complete map of how AI-agent context is organised in this repo: what loads when, every skill and rule in the inventory, and the practices behind them. `CLAUDE.md` stays terse because this file carries the detail; read this when adding/changing skills or rules, not on every session.

## 1) Architecture: three tiers of progressive disclosure

Agent context is priced per session. Everything here is organised so a session only pays for what it actually uses:

| Tier | Location | When it loads | Cost model |
|---|---|---|---|
| **Always-on** | `CLAUDE.md` | Every session, in full | Paid every session — keep terse, invariants and pointers only |
| **Path-scoped rules** | `.claude/rules/*.md` | Auto, when a touched file matches the rule's `paths:` globs | Paid only by sessions touching that area |
| **Skills** | `.claude/skills/*/SKILL.md` | Name + description always visible (~100 tokens total); full body loads only when the task matches the description | Near-free when dormant |

This mirrors the progressive-disclosure model Anthropic published for [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills), an open standard since December 2025 ([agentskills.io](https://agentskills.io)) adopted by OpenAI, Google, GitHub, and Cursor. Skills hot-reload — edits to `.claude/skills/` apply without restarting a session.

**Placement rule** (from the `memory-hygiene` skill): applies every session → `CLAUDE.md`. Applies to specific files → path-scoped rule. A workflow/recipe/behavioural discipline → skill. Reference detail → this file or `docs/`.

## 2) Skill inventory

Model-invoked: each skill fires when the task matches its frontmatter description. Source of truth is always the SKILL.md file itself.

### `plan-gate` — no edits until the plan exists
For **novel or multi-system work only**: work spanning multiple layers together, anything touching a security/trust boundary, a persisted data format, or a core build/deploy pipeline. Forces a written plan (GOAL / UNKNOWNS / SUCCESS CRITERIA / STEPS / OUT OF SCOPE) before the first edit, built from evidence (files read first), with executable success criteria and a hard stop-and-replan rule when reality contradicts the plan. Deliberately narrow — routine work already covered by an existing checklist doesn't need a five-block plan.

### `scope-fence` — do what was asked, flag what you found
Fires on any modification of existing work. The requested change and its genuine requirements are in scope; everything else noticed along the way is flagged ("Noticed, NOT touched: …"), never silently fixed. Gray-zone tests: would X break without the extra edit (in scope); is it "while I'm here" (out); formatting churn on untouched lines (revert).

### `ruthless-editor` — every sentence earns its place
Fires on public-facing/persistent prose: docs, READMEs, PR bodies, reports. A separate cutting pass after drafting — per-sentence tests (needed to act? repeated? hedging? abstract-where-concrete-possible?), structural cuts (lead with outcome, kill throat-clearing), target ~30% shorter with zero information loss, with explicit guards against over-compression (clarity outranks brevity). Not for code, commit messages, or routine chat replies.

### `memory-hygiene` — memory is a claim about the past
Fires when reading or writing persistent agent memory (`CLAUDE.md`, rules, skills, this file). Write side: persist decisions-with-why, corrections received, non-obvious constraints, user preferences; never what code/git already records; prune when adding; put each fact in the right tier. Recall side: grade staleness (system state ages fast, decisions slowly); fast-aging fact + consequential action → verify against live state first; live state wins disagreements and the memory gets fixed in the same breath.

### `pr-changelog` — the PR is the public changelog *(example — delete if you don't publish PR bodies)*
Worked example of a domain-specific skill built on the generic ones. Fires on every PR title/body write, assuming merges auto-publish somewhere public. Audience-facing voice, present tense, area-sectioned bodies leading with user impact, one honest line for chores, and hard bans on attribution/AI mentions/internal links/secrets. Ends with a mandatory `ruthless-editor` pass. Adapt the placeholders (`<publish target>`, `<audience>`) or delete entirely if you have no such pipeline.

## 3) Path-scoped rule inventory

Keep this table current — it's the fastest way for a human (or a fresh agent session) to see what detail exists without loading it. See `.claude/rules/README.md` for the format and `.claude/rules/example-rule.md` for a filled-in template.

| Rule | Scope (`paths:`) | Contents |
|---|---|---|
| *(none yet — add your first real rule and list it here)* | | |

## 4) Authoring practices (for new skills/rules)

- **Only encode what pushes the agent away from its defaults.** A skill restating obvious good practice wastes its trigger and its tokens. Careful planning on complex tasks is a default; a *plan format and stop-rule* is not.
- **The description is the contract.** It is the only part always in context, so it alone decides when the body loads. State the trigger AND the non-trigger ("Do not use for…"). Over-triggering is the classic failure mode — it taxes every session and dilutes trust in skills generally.
- **Small and composable beats monolithic** (philosophy borrowed from [mattpocock/skills](https://github.com/mattpocock/skills)). One skill per workflow; skills may reference each other (`pr-changelog` → `ruthless-editor`).
- **Prune the overlap in the same change.** When a skill/rule supersedes lines in `CLAUDE.md`, delete them then. Duplicated guidance is paid twice and drifts into contradiction.
- **Exact examples over abstractions.** Agents pattern-match; a concrete snippet outperforms a paragraph describing the shape.
- **When a SKILL.md grows unwieldy, split** into referenced files loaded on demand (tier 3 of progressive disclosure).

## 5) Subagents and token economy

- Prefer skills + path-scoped rules over spawning subagents for small-to-medium repos: each subagent starts cold and re-reads always-on context, so it is the expensive path.
- Exception: read-only, broad-fan-out search agents — they keep file dumps out of the main context and return only conclusions.
- In-session discipline (output shaping, effort routing, narrow reads) belongs in `CLAUDE.md` and applies always.

## 6) Maintenance

- A skill that keeps misfiring → fix its description first, body second.
- New skill/rule → add it to the inventory here and to the `CLAUDE.md` skills list in the same change.
- Everything here follows `memory-hygiene`: dated where it will age, pruned when added to, verified before being trusted.

Further reading: [Anthropic — Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) · [Agent Skills open standard](https://agentskills.io) · [mattpocock/skills](https://github.com/mattpocock/skills) (user-invoked vs model-invoked split, composability, `writing-great-skills`).
