# Jev chat tool-routing POC

This experiment tests whether TypeSafe Jev improves the helper's `search_tools` routing over the current deterministic lexical matcher. It does not change gameplay, action authority, confirmation, saves, or the main chat model.

## Safety boundary

Jev receives only the short routing phrase supplied to `search_tools` plus static MCP tool names/descriptions. Character state, account identity, authorization, bank/inventory contents, action arguments, saves, and tool results are not sent to TypeSafe by this router.

The production and preview flags default to off. When disabled, the helper uses the existing lexical router. When enabled, a missing key or Jev/API failure falls back to lexical routing. An explicit Jev `__no_match__` is kept as a real result so the experiment measures Jev rather than hiding its misses.

## Setup

Set `TYPESAFE_API_KEY` as a Worker secret. To exercise the live POC, set `CHAT_JEV_TOOL_ROUTING=true` in the target environment. Turning the flag off is the rollback.

## Benchmark

Run:

```bash
TYPESAFE_API_KEY=... npm run benchmark:chat-routing
```

The default corpus covers tools that are normally hidden behind `search_tools`. Use `-- --scope=all` to include always-on tools, and `-- --runs=N` to repeat each case.

The report compares top-1, top-3 and top-6 accuracy, request errors, median/p95 latency, Jev token usage and individual top-1 misses. Judge adoption from repeated live results: Jev should materially improve semantic top-1 accuracy without unacceptable latency, reliability or cost. A successful API call alone is not evidence that the router is better.
