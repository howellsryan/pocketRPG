# Handoff prompt — implement the MCP gap-closure plan

> Paste everything in the fenced block below to the implementing agent. It is
> written to keep a less‑capable agent strictly on plan, one work order per
> commit, with no scope drift.

```
You are implementing a fixed, pre-approved plan in the PocketRPG repository. The
plan lives at docs/mcp-gap-plan.md. Read it in full before doing anything, then
execute it EXACTLY. Do not redesign it, do not add scope, do not skip ahead.

GROUND RULES (non-negotiable):
1. Work ONLY on git branch `claude/mcp-api-gaps-review-ozuimn`. Create it from the
   current branch if it doesn't exist. Never push to any other branch. Do NOT
   open a pull request unless I explicitly ask.
2. The work is defined by Work Orders WO-1 through WO-14 in docs/mcp-gap-plan.md
   section 4. Do them IN ORDER. Each work order = exactly ONE commit.
3. Before EVERY commit run the full commit gate and make sure it passes:
       npm test && npm run build && npm run rebuild && npm run check:single
   If it fails, fix your change until it passes. NEVER commit with a failing gate.
   Never hand-edit the generated index.html.
4. Use the exact commit message given at the end of each work order.
5. After each commit, push with:
       git push -u origin claude/mcp-api-gaps-review-ozuimn
   then move to the next work order.

HOW TO IMPLEMENT (follow the recipes in docs/mcp-gap-plan.md section 1):
- Almost every change touches three files: functions/_lib/mcp/schema.js (tool
  metadata), functions/_lib/mcp/tools.js (dispatch), functions/_lib/mcp/intents.js
  (pure save mutations). Read those three files and the existing tools FIRST and
  copy their patterns precisely.
- NEVER duplicate game logic. Reuse an existing /api/* handler via callHandler
  (bridge), or an existing pure engine simulator/helper (intent). If the browser
  computes something that isn't in a shared module yet, EXTRACT it into a shared
  module that both the screen and the MCP import — do not copy-paste the math.
- Mirror src/state/gameState.jsx load-time application field-for-field for any
  save mutation, so MCP and the browser never drift.
- Keep every existing guard: assertNotInActiveMatch (PvP lock) on every write,
  assertNoActiveQuest before starting an idle activity, One-Life combat refusal,
  the start_fight idle-food warning, XP cap 200,000,000, 28-slot inventory,
  Math.floor rounding. Audit every mutation with
  auditLog(env, 'mcp_<action>', {...}, { swallow:true }).
- Add or update a test for every work order (tests/mcpIntents.test.ts,
  tests/mcpServer.test.ts, tests/skilling-tools.test.ts are the patterns).

ABSOLUTELY OUT OF SCOPE (do not build, do not touch — see section 3 of the plan):
- Anything PvP (functions/api/pvp/**, matches, invitations, lobby).
- Offline/automatic special attacks (manual-only by design).
- One-Life combat via MCP (keep the refusal).
- Account deletion, real-money/Stripe purchases, OAuth/login, raw save writes.
- Cosmetic UI (bank tabs, shortcuts, reordering). Item charging is note-only.

STOP-AND-ASK rule: if a work order is ambiguous, or you find yourself needing to
touch PvP or any design-excluded area, or a change would require redesigning the
plan, STOP and ask me a specific question. Do NOT improvise or pivot. WO-9 is
explicitly optional and must not be started without my go-ahead.

Begin with WO-1. After each work order, post a one-line status (work order, commit
hash, gate result) and continue to the next. Do not stop until WO-1 through WO-14
are committed and pushed, or you hit a STOP-AND-ASK condition.
```
</content>
