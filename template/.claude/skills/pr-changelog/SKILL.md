---
name: pr-changelog
description: Use whenever writing or editing a pull request title or body for this repo, IF merged PR titles/bodies auto-publish somewhere public (e.g. a Discord/Slack changelog channel, a release page). Encodes the target voice, structure, and hard bans, plus a mandatory cutting pass. Delete this skill if you don't have such a pipeline.
---

# pr-changelog: the PR is the public changelog

This is a **worked example**, not a generic skill — it assumes merging to your main branch triggers something that posts the merged PR title + body somewhere public (a CI job posting to Discord/Slack, a release-notes generator, etc). Adapt the specifics (target channel, char limit, workflow file) to your setup, or delete this skill entirely if no such pipeline exists.

Fill in: `<publish target>` (e.g. "the `#changelog` Discord channel"), `<trigger mechanism>` (e.g. "`.github/workflows/changelog.yml`"), `<audience>` (e.g. "players", "users", "customers").

## Title

Minimal but explicit about what changed, present tense, `<audience>`-facing voice — no branch/ticket/file jargon.
- Single change → name it exactly: "Search now indexes attachments", not "fix: search indexer attachment wiring".
- Multiple changes → one short line that summarises them.
- If your CI auto-appends a PR number, don't add one yourself.

## Body

- **Split by area into titled sections**: several areas → one `##` heading each, that area's changes underneath. Single-area change → one section or none.
- Within a section: lead with user impact, short bullets, plain language — no file paths, function names, or internal mechanics unless the reader would care.
- Pure chores with no user-visible effect (deps, refactors, CI) → one honest line; it still posts if your pipeline publishes every merge.
- Reviewer-only detail goes in PR review comments or an HTML comment (if your pipeline strips those before publishing), never the visible body.

## Hard bans (publishes verbatim — no exceptions)

- **No attribution or internal links, ever**: no repo/PR URLs, no AI-tool session links, no "Co-Authored-By", no statement that the change was made by an AI agent — title or body.
- **No secrets, tokens, hostnames, or internal-only notes.** Public the moment it merges.

## The cutting pass (required before submitting)

Run the `ruthless-editor` pass on the drafted body: cut throat-clearing, cut restated context, make every bullet concrete. A reader scanning the changelog should get the whole story from the section headings and first bullets.
