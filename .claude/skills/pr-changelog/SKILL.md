---
name: pr-changelog
description: Use whenever writing or editing a pull request title or body for this repo. Merged PR titles and bodies auto-publish verbatim to the players' Discord changelog, so every PR is player-facing copy. Encodes the voice, structure, and hard bans, plus a mandatory cutting pass.
---

# pr-changelog: the PR is the public changelog

Merging to `main` deploys to production and auto-posts the merged **PR title + body** to the Discord `#changelog` channel (`.github/workflows/discord-changelog.yml` → `DISCORD_CHANGELOG_WEBHOOK`). The whole body publishes — first ~3900 chars; `<!-- -->` HTML comments are stripped, nothing else is. **Write every PR for players, not just reviewers.**

## Title

Minimal but explicit about what changed, present tense, player-facing voice — no branch/ticket/file jargon.
- Single change → name it exactly: "Prayer now drains in PvP", not "fix: prayerDrain PvP pool wiring".
- Multiple changes → one short line that summarises them: "Prayer, Slayer, and daily-task fixes".
- The `(#123)` number is appended automatically — don't add one.

## Body

- **Split by area into titled sections**: several areas → one `##` heading each, that area's changes underneath. Single-area change → one section or none.
- Within a section: lead with player impact, short bullets, plain language — no file paths, function names, endpoint names, internal mechanics, or spec-section references (`§N`) unless a player would care.
- **No implementation narrative.** Don't explain *how* the change works, *why* it's safe, or what it replaces internally — that's review content, not changelog content. If the honest player-facing summary is one line, stop at one line; don't pad it with the engineering rationale.
- Pure chores with no player-visible effect (deps, refactors, CI, internal API consolidation) → one honest line; it still posts.
- Reviewer-only detail (safety reasoning, invariants preserved, migration plans, rollout notes) goes in PR review comments or an HTML comment, never the visible body.

**Known failure mode**: PR #906 ("Boot in one request instead of six") drafted a multi-paragraph body full of endpoint names, function names, call-site counts, and `§14` reasoning — exactly the style this skill forbids — and it published verbatim. A chore with no player-visible effect gets one line, full stop; the technical justification for *why* it's safe never belongs in the body at all, no matter how relevant it felt while writing it.

## Hard bans (publishes verbatim — no exceptions)

- **No attribution or internal links, ever**: no GitHub URLs, no Claude Code / session links, no "Co-Authored-By", no "Generated with Claude Code", no statement that the change was made by Claude / an AI agent — title or body.
- **No secrets, tokens, hostnames, or internal-only notes.** Public the moment it merges.

## The cutting pass (required before submitting)

Run the `ruthless-editor` pass on the drafted body: cut throat-clearing, cut restated context, make every bullet concrete ("Prayer potions now restore 20 points" beats "improved prayer restoration"). A player scanning Discord should get the whole story from the section headings and first bullets.
