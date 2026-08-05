# Cloudflare Pages → Workers migration

Status: **planned**, phase 1 in progress. Owner: repo maintainer.

## Why

Cloudflare has put Pages into maintenance: *"If you are starting a new project,
use Workers instead of Pages… all of our investment, optimizations, and feature
work will be dedicated to improving Workers."* Pages keeps working and there is
no deadline, so this is deliberate, not urgent.

The reason to actually do it is structural, and it is one thing above all
others: **a Pages project cannot export a Durable Object class.** That single
constraint is the root of the worst operational hazard in this codebase.
`CoopBossRoom` is defined in the `pocketrpg-world` Worker and bound cross-script
from Pages (`wrangler.toml`, `COOP_ROOM`), which forces:

- the two-deploy rule (§20, §21) — co-op and raids need both projects deployed,
- `coopRoomsAvailable` / `COOP_UNAVAILABLE` degradation (`functions/_lib/game/coopRoom.js`),
- the `coopRoomSupportsRaids` capability probe, which exists only because a
  stale Worker settles every raid kill against the first boss's drop table —
  a server-granted **economy bug** whose sole cause is deploy skew.

On Workers the class is exported by the same Worker that calls it, and that
entire category disappears.

Secondary wins: Cron Triggers (Pages has none — the stale-member sweeps,
`world_sessions` expiry and `save_history` pruning currently ride request
paths), versioned/gradual deploys with instant rollback, per-route Smart
Placement, and real Workers Observability.

## What this is NOT

**This migration will not reduce D1 requests by one.** D1 cost is a function of
query code, not host. Cost is otherwise a wash: static-asset requests are free
on both, and Pages Functions bill at Worker rates.

The D1 work is a separate, more valuable project — phase 1 below — and it ships
first, on Pages, so its benefit is not gated on the hosting change.

## Target architecture

**One Worker.** Site + API + `WorldZone` + `CoopBossRoom`.

Multiple Workers only earn their keep with separate scaling, blast radius or
teams — none apply — and any split re-creates the cross-script binding this
migration exists to remove (`CoopBossRoom` is called only from `/api/coop/*`,
so leaving it in a world Worker puts a network hop back between them).

```
pocketrpg (single Worker)
├── assets: idle-game build (index.html + game-<hash>.js) and world client
├── router: /api/**            → the 68 handlers now under functions/
│           /api/world/**      → world session, leave beacon, pvp-count, editor
│           partyserver routes → WorldZone
│           *                  → ASSETS
├── DO: WorldZone, CoopBossRoom   (local exports, no script_name)
└── bindings: DB (D1), TRIPO_ASSETS (R2), AI, + secrets
```

## Phases

Phases 2–4 are **one project**. Do not start phase 2 without intending to finish
phase 3: stopping in between leaves you with the cross-script binding *and* a
hand-written router — strictly worse than today.

---

### Phase 1 — Cut D1 reads (ships on Pages, independent)

The measurable win, and it lands before any hosting risk.

**The boot fan-out.** A signed-in boot currently issues ~9 API requests:
`/api/auth/me`, `/api/characters`, `/api/save`, `/api/kill-counts`,
`/api/hard-mode`, `/api/daily-tasks`, `/api/collection-log`, `/api/idle`,
`/api/activity-progress`. Six of those re-run the *same* `characters` ownership
SELECT before doing their own work — and repo-wide that predicate is
hand-rolled in **16 files**, only one of which is the canonical
`_lib/character.js` `getOwnedCharacter`. The divergence is a latent security
risk (each copy can drift), but consolidating it saves no D1 reads, so it is
scoped here to the five endpoints bootstrap subsumes and left otherwise for its
own change.

Work:
1. Collapse the five subsumed endpoints' ownership copies onto `getOwnedCharacter`.
2. Add `GET /api/bootstrap`: one auth, one ownership read, then the kill-counts,
   hard-mode, daily-tasks, idle-state and activity-progress payloads in one
   response. Existing endpoints stay (native shells, MCP, staged rollout).
3. Client calls it once from the cloud-init path, feeding the existing
   `syncServerKillCounts` / `syncHardModeTargets` / daily-task / idle-state
   setters unchanged.

Exit criteria: boot drops from ~9 requests to ~3; `killCountsLoaded` still gates
on kill-counts **and** the Hard Mode mirror together (§4 — a fight built before
the mirror lands is an unscaled boss paid at doubled rates).

Not folded in: `/api/save` (large blob, own revision protocol) and
`/api/collection-log` (large, already fire-and-forget behind a cache).

**Caching.** No KV binding and no Cache API use exists anywhere today. The
read-mostly, non-authoritative endpoints — `/api/coop/bosses`, `/api/coop/raids`
(polled by the picker), `/api/leaderboard`, `/api/trading-post/search`,
`/api/trading-post/listings` — take a few seconds' TTL. §14 already declares the
leaderboard best-effort.

**D1 read replication (Sessions API)** on the read-heavy paths: leaderboard,
collection log, trading-post search. Latency and scaling, no correctness cost —
but never on a save/grant path, where a stale replica read would defeat the
`save_revision` guard.

---

### Phase 2 — Pages → Workers, API only

Keep `pocketrpg-world` exactly as-is, cross-script binding included. Only the
front door changes.

Work:
- Root `wrangler.toml` → `wrangler.jsonc` with `assets` + `main`.
- Router over the 68 handlers. Scope is smaller than it looks: only **3**
  dynamic segments (`coop/session/[id]`, `coop/session/[id]/*`,
  `tripo-assets/[[key]]`) and **one** `_middleware.js` (CORS + the per-request
  quest-gate bypass, which must stay installed on every request including the
  `false` ones — `functions/api/_middleware.js`).
- `onRequestGet/Post/Put/Delete` exports become method-dispatched handlers;
  `context.params` becomes a router param object.
- `_headers` becomes asset config / response headers in code.
- Move `functions/` → `src/server/` (or keep the path; the directory name stops
  being magic either way).

Risks: the §14 integrity boundary is entirely inside these routes. Every route
must keep `requireAuth`, `assertNotInCoopSession`, and the three `/api/save`
guards. A route silently unrouted is a 404, but a route that loses its
middleware is a security regression — the router needs a test asserting every
handler file is reachable and wrapped.

Exit criteria: full `npm run ci` green; every `/api/**` path resolves with
identical status/shape; OAuth discovery under `.well-known/**` still served;
preview environment parity including `DISABLE_QUEST_REQUIREMENTS` staying out
of production config (`tests/questGateProduction.test.ts`).

---

### Phase 3 — Fold the world Worker in

Both DO classes become local exports of the one Worker.

**Durable Object classes cannot be moved between Workers carrying their state.**
`WorldZone` and `CoopBossRoom` are re-created fresh in the new Worker; in-flight
fights and world sessions are lost at cutover. Acceptable — `CoopBossRoom`
checkpoints to D1 every 15s in a fight and world HP is a session resource that
no flush writes back to the save (§4) — but it is a drain-and-cutover at a quiet
hour, announced, not a rolling deploy.

Compat dates differ (`2025-01-01` API vs `2026-07-01` world). Merging on the
newer one needs a pass over the API code for behaviour changes.

Then delete, in the same change:
- `coopRoomSupportsRaids` and its `capabilities` probe,
- `coopRoomsAvailable` / the `COOP_UNAVAILABLE` degradation path,
- the two-deploy rule from `CLAUDE.md` §20 and §21, and the raid-mismatch
  warning in §21.

Exit criteria: one deploy command; `world/` tests and API tests in one suite;
co-op and raids reachable with no capability probe.

---

### Phase 4 — Cron triggers

Move off request paths: stale co-op member sweep, `world_sessions` expiry,
`save_history` pruning, trading-post listing expiry.

Keep the opportunistic sweeps as a fallback — a cron that stops firing must
degrade to today's behaviour, not to a stuck save lock.

## Rollback

- Phase 1: ordinary revert; the old endpoints are never removed.
- Phase 2: Pages project stays deployed until DNS cuts over. Rollback is a DNS
  change.
- Phase 3: the riskiest step. Once DO state is created in the new Worker,
  rolling back re-loses it. Cut over at a quiet hour and hold the old Worker
  deployed for a day.
