<!--
================================================================================
THIS BODY AUTO-PUBLISHES VERBATIM TO THE PLAYERS' DISCORD #changelog ON MERGE.
Only <!-- --> HTML comments are stripped. Everything else is public copy.
See CLAUDE.md §20 and the pr-changelog skill.

  - Player-facing voice; split by area into ## sections; lead with player impact.

HARD BAN — NEVER put any of these in the title or body (no exceptions):
  - "Co-Authored-By" / "Co-authored-by" trailers
  - "Claude-Session", any session_... id, or claude.ai/code links
  - "Generated with/by Claude", any AI/Claude/Anthropic attribution
  - GitHub URLs, secrets, tokens, hostnames, or internal-only notes

These are commit-message trailers. Keep them in commits ONLY — never let them
reach the PR title/body. The Discord workflow now strips and then hard-fails on
any that slip through (.github/workflows/discord-changelog.yml), so a leak
blocks the changelog post entirely. Don't rely on it — keep them out.
================================================================================
-->
