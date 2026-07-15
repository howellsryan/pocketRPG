# Squad Workflow — team-based agentic delivery

Every cloud-session task is triaged into a delivery tier, and anything non-trivial is delivered by a squad of role agents (BA → architect → domain builders → QA) coordinated by the lead session. This doc is the design record; the operational protocol lives in the `squad-triage` skill and the role charters in `.claude/agents/`.

## Research inputs

**[bradygaster/squad](https://github.com/bradygaster/squad)** — human-led AI teams for GitHub Copilot. Not directly adoptable (it orchestrates via the Copilot CLI, `squad init` + `copilot --agent squad`), but three ideas transfer:

1. **Charters live in the repo** — each agent is an inspectable markdown file (identity, expertise, constraints) that persists learnings across sessions.
2. **Routing rules** — task descriptions map to roles mechanically, not ad hoc.
3. **Humans own priorities and approvals** — agents own coordination, repetition, and parallel execution.

**[Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)** — experimental (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). A lead session spawns teammates that share a task list, message each other, and self-claim work. Key facts that shaped this design:

- **Subagent definitions are the portable primitive.** A `.claude/agents/*.md` file works both as an Agent-tool subagent (stable, available in cloud sessions today) and as a teammate role in an agent team. Defining roles there means one charter serves both orchestration modes.
- Teams cost tokens linearly per teammate and add coordination overhead; docs recommend 3–5 teammates, tasks sized to clear deliverables, and **file-ownership partitioning** to avoid conflicting edits.
- Limitations: one team per session, no nested teams, no session resumption of teammates, lead is fixed. Do **not** pre-author `~/.claude/teams/` config — it's runtime state; `.claude/teams/teams.json` in a project is ignored.
- Quality gates can be enforced mechanically via `TaskCreated` / `TaskCompleted` / `TeammateIdle` hooks (exit 2 = reject with feedback).

## Design

### Orchestration: charters first, transport second

Roles are defined once as subagent charters in `.claude/agents/`. The lead session picks the transport per session:

- **Agent teams** when the harness supports them (interactive terminals with the env flag, now set in `.claude/settings.json`): shared task list, inter-agent messaging, plan approval for the architect.
- **Background subagents via the Agent tool** everywhere else — including cloud/web sessions, where this is the verified-working path. The lead is the message bus: it fans out role prompts, collects reports, and integrates.

Either way the lead (the main session) stays coordinator and accountable: it runs triage, writes the role prompts, resolves conflicts, runs the §11 commit gate, and writes the PR. The lead never becomes a builder in squad-tier work — it delegates and integrates.

### The roster (`.claude/agents/`)

| Role | Owns | Writes code? |
|---|---|---|
| `technical-ba` | Requirements → task breakdown, acceptance criteria, edge cases | No (read-only) |
| `architect` | System design, client/server boundary (§14), build safety (§12), migrations | No (read-only, produces the plan) |
| `gameplay-engineer` | `src/engine/**`, `src/data/**`, gameplay invariants (§4–§7) | Yes |
| `frontend-designer` | `src/screens|components|state|hooks/**`, PRODUCT.md/DESIGN.md language | Yes |
| `backend-developer` | `functions/**`, `migrations/**`, audit events, integrity boundary | Yes |
| `senior-qa` | `tests/**`, adversarial review, the §11 gate | Yes (tests only) |

Charters are terse and pointer-heavy: they cite the CLAUDE.md sections and path-scoped rules that already encode the domain knowledge rather than duplicating them (every agent loads CLAUDE.md cold).

### Triage tiers (the `squad-triage` skill)

Full squads on trivial work would torch tokens for nothing (SKILLS.md §5), so triage right-sizes first:

- **Solo** — one file/domain, obvious test, or docs/content covered by an existing checklist. Lead does it directly. Stated explicitly: "squad-triage: solo".
- **Pair** — one domain but real logic risk: one builder role + `senior-qa`.
- **Squad** — spans ≥2 domains (engine + UI, client + server), touches the §14 integrity boundary, or is novel enough for plan-gate: `technical-ba` decomposes → `architect` plans (plan approval where teams support it) → domain builders in parallel with disjoint file ownership → `senior-qa` gates.

Every role prompt carries: goal, owned files (disjoint per builder), constraints (relevant CLAUDE.md §s), executable acceptance criteria, and the report format. The BA's breakdown reuses the plan-gate block (GOAL / UNKNOWNS / SUCCESS CRITERIA / STEPS / OUT OF SCOPE).

### What makes it standard

1. **CLAUDE.md §13** (always loaded) mandates triage at task start — this is also the standing authorization to spawn agents, which harness defaults otherwise reserve for explicit user requests.
2. **`squad-triage` skill** carries the protocol so the always-on cost stays ~2 lines.
3. **`.claude/settings.json`** sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` so team-capable harnesses light up without per-user setup.
4. Charters in `.claude/agents/` version with the repo — every session, cloud or local, sees the same roster.

There is no mechanical hook that can *force* a session to spawn agents; the enforcement is the always-on directive plus the skill, same as scope-fence and the commit gate. Team-mode sessions can additionally wire `TaskCompleted` hooks to hard-gate `npm run ci` later if directive-level compliance proves leaky.

## Risks / accepted trade-offs

- **Agent teams are experimental** and unverified in cloud sessions — hence subagents as the guaranteed transport and charters as the portable layer. Revisit when teams stabilize.
- **Token cost**: squad-tier work multiplies context spend. Mitigated by triage tiers, 3–5 agent ceiling, and pointer-heavy charters. SKILLS.md §5 ("subagents are the expensive path") is now qualified by, not contradicted by, this workflow: solo remains the default for small work.
- **Same-file conflicts**: builders get disjoint file ownership in their prompts; overlaps route through the lead.
- **QA is a role, not a substitute for the gate**: `npm run ci` still runs in the lead before commit, regardless of tier.

## Rollout

1. This change: charters, skill, CLAUDE.md/SKILLS.md wiring, env flag (all in one PR).
2. Next few squad-tier tasks: watch for over-triage (squads on pair-sized work) and prompt quality; tune the skill's tier tests.
3. Later, if warranted: `TaskCompleted` hook enforcing the test gate in team mode; per-role learnings files if charters prove too static (squad's `.squad/skills/` idea).
