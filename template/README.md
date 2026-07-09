# Agentic Dev Template

A starting point for setting up a new repository for AI-agent-assisted development (Claude Code and compatible tools). Drop this into a fresh repo and adapt.

## What's in here

```
template/
├── CLAUDE.md                    → copy to repo root, fill in the placeholders
├── SKILLS.md                    → copy to repo root, keep in sync as you add skills/rules
└── .claude/
    ├── skills/                  → model-invoked skills (fire automatically by description match)
    │   ├── plan-gate/
    │   ├── scope-fence/
    │   ├── memory-hygiene/
    │   ├── ruthless-editor/
    │   └── pr-changelog/
    └── rules/                   → path-scoped rules (auto-load when matching files are touched)
        ├── README.md
        └── example-rule.md
```

## How to use this

1. Copy `CLAUDE.md` and `SKILLS.md` to your repo root. Fill in every `<placeholder>`.
2. Copy `.claude/` to your repo root.
3. Read each `SKILL.md` — they're generic but written for a game-like project with example prose. Adjust names/examples to your domain. `pr-changelog` in particular assumes a public changelog channel; delete it if you don't have one, or repoint it at your actual publish target.
4. Delete `.claude/rules/example-rule.md` once you've written your first real rule, or keep it as a live reference.
5. Update `SKILLS.md` any time you add, remove, or change a skill or rule — it's the map, and a stale map is worse than none.

## Why this shape

Agent context is priced per session. This structure is progressive disclosure:

| Tier | Where | Loads | Cost |
|---|---|---|---|
| Always-on | `CLAUDE.md` | every session, in full | paid every session — keep it terse |
| Path-scoped rules | `.claude/rules/*.md` | only when a touched file matches the rule's `paths:` globs | paid only by sessions touching that area |
| Skills | `.claude/skills/*/SKILL.md` | name + description always visible; full body loads only when the task matches | near-free when dormant |

The four skills included (`plan-gate`, `scope-fence`, `memory-hygiene`, `ruthless-editor`) are domain-agnostic behavioural disciplines — they encode how to work carefully, not what your product does. `pr-changelog` is included as a worked example of a domain-specific skill built on top of the generic ones (it calls `ruthless-editor`).

Further reading: [Anthropic — Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) · [Agent Skills open standard](https://agentskills.io) · [mattpocock/skills](https://github.com/mattpocock/skills).
