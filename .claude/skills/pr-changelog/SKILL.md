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
- Within a section: lead with player impact, short bullets, plain language — no file paths, function names, or internal mechanics unless a player would care.
- Pure chores with no player-visible effect (deps, refactors, CI) → one honest line; it still posts.
- Reviewer-only detail goes in PR review comments or an HTML comment, never the visible body.

## Hard bans (publishes verbatim — no exceptions)

- **No attribution or internal links, ever**: no GitHub URLs, no Claude Code / session links, no "Co-Authored-By", no "Generated with Claude Code", no statement that the change was made by Claude / an AI agent — title or body.
- **No secrets, tokens, hostnames, or internal-only notes.** Public the moment it merges.

## The cutting pass (required before submitting)

Run the `ruthless-editor` pass on the drafted body: cut throat-clearing, cut restated context, make every bullet concrete ("Prayer potions now restore 20 points" beats "improved prayer restoration"). A player scanning Discord should get the whole story from the section headings and first bullets.
