# Headroom — token reduction for Claude Code on PocketRPG

[Headroom](https://github.com/headroomlabs-ai/headroom) is a **local** context
compression layer for AI agents. It cuts token usage (the project claims 60–95% on
context) by compressing tool outputs, logs, and conversation history before they
reach the model, and optionally **shaping output** to make responses terser.

This repo ships a thin wrapper so contributors can run Claude Code through Headroom
with output shaping already enabled.

## TL;DR

```bash
# one-time install
pip install "headroom-ai[all]"        # or: npm install -g headroom-ai

# launch Claude Code wrapped by Headroom (output shaper ON)
npm run claude:headroom               # == ./scripts/headroom-claude.sh
```

That's it. `headroom wrap claude` launches and orchestrates Claude Code itself —
you do **not** need to start the proxy separately.

## What the wrapper turns on

`scripts/headroom-claude.sh` exports these before launching (override by exporting
your own values first):

| Variable                  | Default set here | Purpose                                            |
| ------------------------- | ---------------- | -------------------------------------------------- |
| `HEADROOM_OUTPUT_SHAPER`  | `1`              | Shorten model responses to save **output** tokens. |
| `HEADROOM_OUTPUT_HOLDOUT` | `0.1`            | Keeps a 10% control group so you can measure real output savings (`headroom perf`). Set `0` to disable. |
| `HEADROOM_UPDATE_CHECK`   | `off`            | Silence update-check noise.                         |

Check your savings any time with:

```bash
headroom perf
```

## Important scope note (read this)

Headroom wraps Claude Code **at launch time** and runs **on your machine**. That has
two consequences:

1. **It only affects sessions you start locally through the wrapper.** It is not a
   setting an already-running agent can flip mid-session — the compression/transport
   is established when `headroom wrap claude` launches the process.
2. **It cannot reroute a Claude Code Web / cloud session** (e.g. claude.ai/code or a
   GitHub-triggered run). Those sessions' model transport is managed by Anthropic's
   infrastructure, not by env vars or files in this repo, so there is nothing local
   for Headroom to sit in front of. Use the wrapper for local development.

## Alternative: proxy mode

If you'd rather run Headroom as a standalone local proxy and point an Anthropic
client at it:

```bash
export HEADROOM_OUTPUT_SHAPER=1
headroom proxy --port 8787
# then point a LOCAL client at http://localhost:8787 via ANTHROPIC_BASE_URL
```

Do **not** commit `ANTHROPIC_BASE_URL=http://localhost:8787` into shared
`.claude/settings.json` — it would break any session (including cloud sessions)
where no local proxy is listening. Keep it in your own untracked
`.claude/settings.local.json` if you want it persisted.
