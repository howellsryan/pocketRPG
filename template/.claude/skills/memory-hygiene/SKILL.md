---
name: memory-hygiene
description: Use when writing to or reading from persistent agent memory - CLAUDE.md, .claude/rules/*, SKILLS.md, docs meant for future sessions. Governs WHAT deserves persisting, HOW to write it so it survives time, and the recall rule - verify remembered facts against live state before acting on them. Use it also when a session starts by loading old memory.
---

# memory-hygiene: memory is a claim about the past, not a fact about the present

Persistent memory compounds in both directions. Good memory: every session starts smarter. Bad memory: one stale "fact" confidently recalled outvotes the live system in front of you. In this repo the memory is `CLAUDE.md` (always loaded), `.claude/rules/*` (path-scoped), `.claude/skills/*` (on-demand), and `SKILLS.md` (the map).

## Writing: what deserves persistence

Persist what a future session cannot rederive:

- **Decisions and their WHY.** "We chose X over Y because Z" — the why is the part that evaporates.
- **Corrections received.** When the user corrects you, persist it with the reason, so future sessions apply the principle, not just the rule.
- **Non-obvious constraints.** The gotcha that cost an hour. The API that lies. The step that must come first.
- **User preferences.** How they like to be asked, what they care about.

Do NOT persist what the codebase, git history, or docs already record — memory duplicating a derivable fact is bloat that ages into contradiction. Never persist secrets.

## Writing: how

- **Right tier.** Applies every session → `CLAUDE.md` (it is input-token cost on every session — keep it terse). Applies only to certain files → path-scoped `.claude/rules/`. A workflow/recipe → a skill. Reference detail → `SKILLS.md` or `docs/`.
- **Prune when you add.** When a skill or rule supersedes lines in `CLAUDE.md`, delete those lines in the same change.
- **Write the trigger with the fact.** A future session needs to know WHEN this matters: "when touching the publish pipeline, remember X".
- **Small and curated beats large and complete.**

## Recall: the verification rule

Remembered facts are point-in-time observations. Before ACTING on one:

1. **Grade the staleness risk.** Decisions and preferences age slowly. System state (versions, script names, file locations, env vars, what is deployed) ages fast.
2. **Fast-aging fact + consequential action = verify first.** One live probe (does the file exist, does the script run) before building on the memory.
3. **When memory and live state disagree, live state wins** — and update the memory in the same breath.
4. **Say which you are using.** "Per CLAUDE.md" versus "verified just now".

## The maintenance habit

A memory proves wrong: fix it immediately, do not route around it. A memory proves right and important: consider promoting it (clearer trigger, better tier). A memory store nobody prunes becomes a liability with a good reputation.
