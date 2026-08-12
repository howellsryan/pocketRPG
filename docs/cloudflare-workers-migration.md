# Cloudflare Pages → Workers migration

Status: phases 1–3 **built, not yet cut over**. Phase 4 planned. Owner: repo maintainer.

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

### Phase 2 — Pages → Workers, API only  ✅ built

Landed together with phase 3 (they were always one project — see the warning
above), so `pocketrpg-world` was folded in rather than kept.

**What shipped:**
- `wrangler.jsonc` replaces `wrangler.toml`. The Worker is named
  **`pocketrpg-app`**, not `pocketrpg`: the Pages project owns that name and has
  to stay deployed until DNS cuts over (it *is* the rollback), and a Worker that
  hosts Durable Objects can never be renamed afterwards without abandoning their
  state — so the permanent name is chosen now rather than inherited later.
- `worker/router.js` — pure matching and dispatch, no handler imports, so the
  whole table is exercised in tests without the Workers runtime.
  `worker/routes.js` is generated from the `functions/` tree by
  `npm run gen:routes`; `tests/workerRoutes.test.ts` re-derives the same list
  and fails on drift, so a forgotten route is a red build rather than a 404.
- `functions/` keeps its path. The directory name simply stopped being magic.
- `_headers` moves into `dist_site/` unchanged — Workers static assets honours
  it, so the cache rules did not have to be reimplemented in code.
- Assets are staged by `scripts/stage-site.mjs` rather than deploying the repo
  root: a Worker's asset directory is uploaded whole with nothing excluded for
  it, and `node_modules` alone would blow the 20,000-file limit.

**The hazard that was not in the original plan.** Four client flags are baked at
build time from `CF_PAGES_BRANCH`, which only Pages injects. Workers Builds sets
`WORKERS_CI_BRANCH`. Three of the four fail safe when the branch is unknown —
but `worldOrigin` fell back to the *preview* deployment, so the first production
Workers build would have handed live players to preview world state. All four
now derive from one `deployBranch` in `build_single.cjs`, reading either var.

**Fidelity details worth keeping in mind when touching the router.** The
middleware applies to `/api/**` only — `/admin` and `/.well-known/*` never had
it, and giving them CORS now would be a silent change on the admin portal and
the OAuth discovery documents. `/api/characters` must answer with and without a
trailing slash. A `[[key]]` catch-all yields an ARRAY of segments, because
`tripo-assets` joins them back with `/`. An `/api` path with no handler falls
through to the assets *inside* the middleware, so its 404 still carries CORS,
exactly as Pages' `next()` did.

---

### Phase 3 — Fold the world Worker in  ✅ built

Both DO classes are local exports of the one Worker (`worker/index.js`).
`world/server/index.ts` and `world/wrangler.jsonc` are gone; the world's own
HTTP routes (`/api/world/session`, `/api/world/leave`, `/api/world/pvp-count`,
`/api/world/editor/*`) and the partyserver upgrade are answered by the same
`fetch`, ahead of the game API. The quest-gate bypass is installed at the very
top of that `fetch`, before any routing decision, because those routes are
answered before the `/api` middleware that used to install it.

**One Worker has one assets directory**, so the world client now builds with
Vite `base: '/world/'` and stages into `dist_site/world/`.
`worker/worldHost.js` can map a `world.*` hostname onto that prefix, which is
how the standalone `world.pocketrpg.co.uk` custom domain would have kept
working — but its DNS record went missing across the cutover (broke the world
handoff link) and was retired rather than reattached, so `worker/worldHost.js`
is unreachable in practice. Production now reaches the world client the same
way preview always did: `/world/` on the game's own origin. `pocketWorldOrigin`
is a *base*, not an origin — always a bare path, so `fetchWildernessCount`
moved to `apiUrl()`, since `/api/world/pvp-count` answers on the game's own
origin.

**Durable Object classes cannot be moved between Workers carrying their state.**
`WorldZone` and `CoopBossRoom` are re-created fresh in the new Worker; in-flight
fights and world sessions are lost at cutover. Acceptable — `CoopBossRoom`
checkpoints to D1 every 15s in a fight and world HP is a session resource that
no flush writes back to the save (§4) — but it is a drain-and-cutover at a quiet
hour, announced, not a rolling deploy.

Compat dates differ (`2025-01-01` API vs `2026-07-01` world). Merging on the
newer one needs a pass over the API code for behaviour changes.

Deleted in the same change: `coopRoomSupportsRaids` and the room's
`capabilities` action, `coopRoomsAvailable` and the whole `COOP_UNAVAILABLE`
degradation path (including the D1 fallback join, which existed only for a Pages
deploy that had landed ahead of the Worker), the two-deploy rule from `CLAUDE.md`
§20, and the raid-mismatch bullet from §21. `COOP_UNAVAILABLE` still exists for
a room that rejects on fetch — that is a real state; a missing binding is not.

Not done: `world/` keeps its own Vitest project. Merging the suites means
merging the two dependency trees and TS configs, which is a change of its own
and buys nothing the two commands don't already give. `npm run world:check`
still covers it.

**Cutover is a drain, not a rolling deploy.** Durable Object state does not move
between Workers: `WorldZone` and `CoopBossRoom` are re-created fresh, so
in-flight fights and world sessions are lost. Bounded — `CoopBossRoom`
checkpoints to D1 every 15s in a fight and world HP is a session resource no
flush writes back to the save (§4) — but do it at a quiet hour, announced.

**Before the first deploy**, on the new Worker: set every secret listed in
`wrangler.jsonc` (including `WORLD_EDITOR_TOKEN`, which the world Worker owned),
attach `pocketrpg.co.uk` as a custom domain, and confirm Workers Builds sets
`WORKERS_CI_BRANCH` — without it the branch-derived flags all bake to their
production values. Do **not** also attach `world.pocketrpg.co.uk`: that
subdomain was retired (the world client now ships at `/world/` on the same
origin, §"One Worker has one assets directory" above) — reattaching it would
just resurrect a second DNS record to keep in sync for no benefit.

---

### Phase 4 — Cron triggers

Move off request paths: stale co-op member sweep, `world_sessions` expiry,
`save_history` pruning, trading-post listing expiry.

Keep the opportunistic sweeps as a fallback — a cron that stops firing must
degrade to today's behaviour, not to a stuck save lock.

## Rollback

- Phase 1: ordinary revert; the old endpoints are never removed.
- Phases 2–3: the Pages project and `pocketrpg-world` stay deployed until DNS
  cuts over, so rollback is a DNS change. Past that point it gets one-way:
  once DO state exists in the new Worker, rolling back re-loses it. Cut over at
  a quiet hour and hold the old deployments for a day.
