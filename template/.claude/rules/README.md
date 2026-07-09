# `.claude/rules/` — path-scoped rules

Rules are the middle tier between `CLAUDE.md` (always loaded) and skills (loaded by task description match). A rule auto-loads when a file matching its `paths:` frontmatter is touched in the session — so it's the right place for detailed knowledge about one subsystem that most sessions never need.

## When to write a rule vs. a skill vs. a `CLAUDE.md` section

- **Applies every session, regardless of what's touched** → `CLAUDE.md`. Keep it short; it's a cost paid every time.
- **Applies only when specific files/directories are touched** → a rule here.
- **A workflow or behavioural discipline, not tied to specific files** → a skill (`.claude/skills/`).

## Format

```markdown
---
paths:
  - "path/glob/one/**"
  - "path/glob/two.js"
---

# Rule Title

Content: architecture, gotchas, conventions specific to this subsystem.
```

See `example-rule.md` in this directory for a filled-in template. Delete it once you've written your first real rule, or keep it as a live reference.

## Authoring practices

- **One rule per subsystem**, not one giant rule file. A session touching PvP shouldn't pay for payments-system detail.
- **Cross-reference, don't duplicate.** If `CLAUDE.md` already states the one-line invariant, the rule expands on it rather than restating it.
- **Keep the `paths:` glob list tight and accurate.** An overly broad glob loads the rule for sessions that don't need it; an overly narrow one means it silently fails to load when it should.
- **Update in the same change** that changes the subsystem's behavior — a stale rule actively misleads.
