# Cloudflare logs & observability

PocketRPG deploys as a **Pages** project (`wrangler.toml`), so the Workers-oriented tooling
does not apply: Cloudflare's Observability MCP server reads Workers Logs, which Pages
Functions never populate. Two things work instead.

| Need | Tool | Gives you |
| --- | --- | --- |
| Individual log lines from `functions/**` | `wrangler pages deployment tail` | Live stream, nothing retained |
| Request/error/duration counts over time | Cloudflare GraphQL MCP server | Aggregates, queryable historically |

## 1. Live tail

```bash
npm run logs:tail           # production
npm run logs:tail:preview   # preview environment
npm run logs:errors         # production, --status error only
```

Auth, either one:

- `npx wrangler login` — OAuth, best for interactive use.
- `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in the environment — required for
  non-interactive/CI use. Token needs **Account → Cloudflare Pages → Read**.

Extra filters worth knowing (append to any script, after `--`):
`--status ok|error|canceled`, `--method`, `--header`, `--search <text>` (matches
`console.log` output), `--ip self`, `--sampling-rate <0-1>`, `--format json|pretty`.
Pass a deployment ID or URL as a positional argument to tail one specific deployment
instead of the latest.

Limits that bite:

- **Logs are not stored.** Close the tail and the lines are gone. This is a debugging
  tool, not an audit trail.
- Nothing streams if the deployment exceeds **100 requests/second** over five minutes.
- Maximum **10 concurrent tail clients** per deployment.

## 2. GraphQL analytics via MCP

`.mcp.json` registers `cloudflare-graphql` (`https://graphql.mcp.cloudflare.com/mcp`) for
local Claude Code sessions; approve it when prompted, then complete the OAuth flow. For
Claude Code on the web or claude.ai, add the same URL under
**Settings → Connectors → Add custom connector** — `.mcp.json` is not read there.

Six tools: `graphql_schema_overview`, `graphql_schema_search`, `graphql_type_details`,
`graphql_complete_schema`, `graphql_query`, `graphql_api_explorer`.

Start with `graphql_schema_search` for `pagesFunctions` to locate the current invocations
dataset and its dimensions before writing a query — the schema shifts, so introspect
rather than copying a query from here. `httpRequestsAdaptiveGroups` covers edge-level
traffic for the zone if you want request volume independent of Functions.

`.mcp.json` also registers `cloudflare-docs` (`https://docs.mcp.cloudflare.com/mcp`), which
needs no account access and answers "what does this binding/limit/API actually do" against
live Cloudflare docs rather than model memory.

## 3. Cloudflare agent skills

`.claude/settings.json` registers Cloudflare's own skill marketplace (GitHub
`cloudflare/skills`) and auto-enables the `cloudflare@cloudflare` plugin — nothing is
vendored into this repo, so it updates upstream. Useful members: `wrangler` (correct CLI
syntax), `cloudflare` (platform), `durable-objects` (the open-world session DO),
`workers-best-practices`, `web-perf`. See SKILLS.md for the full list and its listing cost.

`wrangler --install-skills` is the CLI's own installer for the same content, but it writes
to `~/.claude/skills/` (per-machine, not the repo) and its package download fails behind
some proxies. The settings.json registration above is the repo-level equivalent — prefer it.

## Still not covered

- **Historical individual log lines.** Requires a Logpush job to R2/a log sink; none is
  configured today.
- **Pages deployments and build logs.** No MCP server exposes them (the Workers Builds
  server is Workers-only); use `wrangler pages deployment list` or the dashboard.
- **Secrets.** Values are unreadable by design. Set with
  `npx wrangler pages secret put <NAME>` — see `wrangler.toml` for the required list.
