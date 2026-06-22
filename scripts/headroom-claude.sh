#!/usr/bin/env bash
#
# headroom-claude.sh — launch Claude Code wrapped by Headroom for this repo.
#
# Headroom (https://github.com/headroomlabs-ai/headroom) is a LOCAL context
# compression layer. It reduces token usage by compressing tool outputs / history
# on the way in and shaping output (HEADROOM_OUTPUT_SHAPER) on the way out.
#
# IMPORTANT: this only affects Claude Code sessions you launch LOCALLY through
# this wrapper. It cannot retroactively reroute a Claude Code Web / cloud session,
# because that session's model transport is managed by Anthropic's infrastructure,
# not by env vars or files in this repo.
#
# Usage:
#   ./scripts/headroom-claude.sh            # wrap `claude` with output shaping on
#   npm run claude:headroom                 # same, via npm
#
# Prereq (one-time):
#   pip install "headroom-ai[all]"          # or: npm install -g headroom-ai
#
set -euo pipefail

# --- Tunables (override by exporting before calling this script) -------------
# Shorten model responses to save output tokens (off by default in Headroom).
export HEADROOM_OUTPUT_SHAPER="${HEADROOM_OUTPUT_SHAPER:-1}"
# Keep a small holdout so you can measure real output savings; set to 0 to disable.
export HEADROOM_OUTPUT_HOLDOUT="${HEADROOM_OUTPUT_HOLDOUT:-0.1}"
# Silence update-check noise in CI / scripted runs.
export HEADROOM_UPDATE_CHECK="${HEADROOM_UPDATE_CHECK:-off}"
# -----------------------------------------------------------------------------

if ! command -v headroom >/dev/null 2>&1; then
  echo "error: 'headroom' CLI not found." >&2
  echo "       Install it first:  pip install \"headroom-ai[all]\"" >&2
  echo "       (or: npm install -g headroom-ai)" >&2
  exit 127
fi

echo "Launching Claude Code via Headroom"
echo "  HEADROOM_OUTPUT_SHAPER=${HEADROOM_OUTPUT_SHAPER}  (response shaping)"
echo "  HEADROOM_OUTPUT_HOLDOUT=${HEADROOM_OUTPUT_HOLDOUT} (measurement holdout)"
echo

# `headroom wrap` launches and orchestrates the wrapped agent itself; the proxy
# does NOT need to be started separately. Any extra args are forwarded to claude.
exec headroom wrap claude "$@"
