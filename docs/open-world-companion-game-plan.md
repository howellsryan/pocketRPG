# Open-World Companion Game — Research, Recommendation & Plan

> Research brief for a second PocketRPG game: a browser-based, open-world "walk around and actually do things" client that shares accounts, characters, and progression with the existing idle game. Same repo, two deployables. Written 2026-07-09.

## 1) The requirement, restated

- **One character, two games.** Skills, XP, items, and coins earned in either game are visible and usable in the other. PocketRPG remains the "management" game (idle tasks, banking, market); the new game is the "embodied" game (walk to a rock, mine it, fight a monster you can see).
- **Web-based, mobile-friendly** — no Steam, no mandatory download, consistent with PocketRPG's reach.
- **Same repo, two deployables**, each independently releasable.
- **Start tiny**: one skill (e.g. Mining) in one small zone, then a second skill, then combat, then (eventually) seeing other players.
- **Built agent-first** by a solo .NET/C# backend engineer with limited game-dev experience.

## 2) Research: how comparable games do this

### RuneScape itself (the genre's own history)
- The original client was a **Java applet running in the browser** — the genre was born browser-first. Jagex attempted an **HTML5 client in 2013 and cancelled it** because browsers of that era lacked the performance and APIs; they shipped **NXT, a downloadable C++ client, in 2016** instead ([RS Wiki: NXT](https://runescape.wiki/w/NXT)). The key point: the blocker was *2013 browsers*, not the concept. WebGL2 is now universal (including iOS Safari), WASM is mature, and WebGPU is rolling out.
- **Server model**: fully authoritative server on a **600 ms tick**. Clients send input events immediately (e.g. "clicked rock"); the server resolves everything and broadcasts player/NPC update packets once per tick; the client interpolates movement between ticks ([Rune-Server: the 0.6 s tick and protocol](https://rune-server.org/threads/question-about-the-0-6sec-tick-and-the-protocol.674947/), [RSPS wiki: OSRS protocol](https://rsps.fandom.com/wiki/OSRS_Protocol)). This model is *extremely* forgiving: no physics, no client-side prediction beyond movement tweening, no twitch latency requirements. It is the cheapest possible multiplayer architecture to build correctly — and PocketRPG already runs the same 600 ms tick (`TICK_MS = 600`).

### RSPS / preservation scene (proof it works in browsers today)
- **Lost City / 2004Scape** runs RuneScape build 225 with the **server written in TypeScript** and the **client source-ported from Java to TypeScript + WebAssembly**, playable in any modern desktop or mobile browser over WebSockets ([2004Scape/Server](https://github.com/2004Scape/Server), [2004Scape/Client2](https://github.com/2004Scape/Client2), [Rune-Server webclient thread](https://rune-server.org/threads/rs2-webclients-typescript-webassembly.706021/)). This is the strongest single data point: a *complete* RuneScape — pathfinding, combat, skilling, hundreds of concurrent players — running on exactly the web stack we'd use.
- Classic RSPS servers (Java, 317/OSRS protocol) all follow the same shape: single-threaded authoritative game loop, per-tick player/NPC info packets, interest management by proximity ([RSProt](https://rsps.org/news/rsprot-osrs-networking-library)).

### Indie browser MMOs
- **Genfanad** (RuneScape-Classic-inspired MMORPG) shipped **browser-first with Three.js**, art authored in Blender ([Kickstarter FAQ](https://www.kickstarter.com/projects/rosetintedgames/genfanad/faqs), [HN: "I built an indie browser-based MMORPG"](https://news.ycombinator.com/item?id=40802557)). **Ironbane** was an earlier open-source Three.js MMO ([three.js forum](https://discourse.threejs.org/t/ironbane-the-mmo-game-you-can-play-right-in-the-browser/48552)). Solo/small-team browser MMOs on Three.js are an established, repeatable pattern.
- **Melvor Idle** (Jagex-published, RuneScape-inspired idle) demonstrates the *companion-economy* concept we want — an idle game and a "main" universe sharing brand and progression hooks ([melvoridle.com](https://melvoridle.com/)).

### Realtime servers on our current infrastructure
- **Cloudflare Durable Objects** are purpose-built for authoritative multiplayer state: one addressable object per game zone, WebSocket termination, serialized execution (no race conditions), alarms for tick loops, and **WebSocket Hibernation** so idle zones cost nothing while clients stay connected ([DO WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [hibernation example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)). Cloudflare's own demos include realtime games built this way ([CF blog: real-time games with Workers + DOs](https://blog.cloudflare.com/building-real-time-games-using-workers-durable-objects-and-unity/)). DOs bind to the **same D1 database** PocketRPG already uses.
- **Monorepo, multiple deployables** is first-class on Cloudflare: separate Workers/Pages projects from one repo, each with its own root/watch paths so a push only rebuilds what changed ([CF monorepo docs](https://developers.cloudflare.com/pages/configuration/monorepos/), [advanced setups](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)).

## 3) Engine/stack options — pros & cons

### Option A — Three.js client + Cloudflare Worker/Durable Objects server (TypeScript end-to-end) ✅ recommended
**Pros**
- **Three.js is already in this repo** (`public/vendor/three/`, `src/utils/three3d.js`), with a working GLB pipeline: rigged hero (`hero.glb`), monster models, animation retargeting, armour fitting, R2 hosting, `equipmentModels.json` registry. The open-world game's *art pipeline already exists and is documented* (`docs/gear-asset-process.md`, `docs/3d-gameplay-investigation.md`).
- **Direct reuse of `src/engine/`**. It's pure logic with no UI imports by design, and `functions/` *already* imports it server-side (`functions/api/pvp/match/[id]/tick.js` runs `processPvpTick` from `src/engine/pvpEngine.js` on Cloudflare). The world server can import the same combat formulas, XP curve, consumables, prayer drain, and `src/data/*.json` content. **One source of truth for game rules across both games** — this is the decisive argument, because the "must share characters and data" requirement is really a code-and-content-sharing requirement.
- Same auth (JWT), same D1, same Cloudflare account, same deploy tooling. Zero new vendors.
- Agents are at their strongest in TypeScript/web; everything is plain text (no binary scene files), so the whole workstream stays agent-drivable, same as PocketRPG has been.
- Tiny payloads (three.js core ~150 KB gzipped + GLBs streamed from R2) → fast mobile loads.

**Cons**
- Three.js is a renderer, not a game engine — we hand-roll the game loop, entity management, input, and camera. *Mitigation*: the RS-classic model needs none of the hard parts (no physics, no navmesh — tile-grid A* pathfinding, tick-based actions), and the repo already contains working Three.js scene/animation code.
- No visual editor. *Mitigation*: author zones as data (tile grids + object placements in JSON, same authoring style as `world.json`/`worldActivities.json`), plus a simple in-browser dev placement mode later if needed.
- Durable Objects are single-threaded per object. *Mitigation*: that's the RSPS model anyway; shard one DO per zone; Lost City handles hundreds of players on one Node thread.

### Option B — Babylon.js client + same Cloudflare server
Batteries-included TS engine (scene, input, animation, GUI, navigation built in; strong WebGPU support).
**Pros**: fewer subsystems to hand-roll than Three.js; excellent TS docs.
**Cons**: forfeits the repo's existing Three.js investment (vendored build, GLB viewers, retargeting scripts, guard patterns); larger core than three.js; two 3D stacks in one repo if PocketRPG keeps its equip/combat viewers. Everything else (server, sharing, hosting) identical to A. **Verdict**: fine engine, but A's reuse beats B's conveniences here.

### Option C — Unity 6 Web (C#)
Unity 6 finally supports **mobile browsers** officially ([Unity web runtime blog](https://unity.com/blog/engine-platform/web-runtime-updates-enhance-browser-experience)).
**Pros**: real editor, huge learning resources, and it's C# — your home language.
**Cons**: builds are 30–50 MB+ even optimized (Unity's own guidance treats 50 MB as the practical phone ceiling — [forum thread](https://discussions.unity.com/t/unity-6-webgl-build-size-limit-for-phones-is-50mb/948431)); cannot import `src/engine` or `src/data` — every shared rule (XP curve, combat math, item defs) would be **reimplemented in C# and kept in sync forever**, which is where shared-progression games rot; agent workflows degrade badly (binary scenes/prefabs, editor-driven iteration, licensed build machines in CI); separate hosting characteristics; splash/licensing constraints. **Verdict**: the C# comfort is real but everything else fights the requirements.

### Option D — Godot 4 web export
**Cons that end it**: **C# web export is still unsupported in Godot 4** — the .NET runtime WASM can't be dynamically linked into Godot's ([Godot blog](https://godotengine.org/article/platform-state-in-csharp-for-godot-4-2/), [forum status thread](https://forum.godotengine.org/t/is-there-an-update-on-exporting-c-projects-to-web/128821)) — so you'd write GDScript, gaining neither your C# skills nor JS/TS reuse. Web exports are heavy-ish and mobile-web is its weakest platform. Same code-sharing wall as Unity. **Verdict**: no.

### Option E — Three.js client + separate .NET game server (ASP.NET Core + SignalR/raw WebSockets on Fly.io/Azure Container Apps)
**Pros**: the authoritative tick server is honest backend engineering — squarely your C# wheelhouse; great debugging/profiling story.
**Cons**: a second cloud vendor and ops surface (containers, scaling, TLS, regions) next to a serverless stack; the server *cannot* import `src/engine` or the JSON content without a C# port (same sync-rot as Unity, just server-side); D1 isn't reachable from outside Cloudflare, so shared character data would need an API hop back into Workers for every grant. **Verdict**: viable, but you pay the polyglot tax exactly where the games must agree perfectly (game rules + data). Your backend instincts transfer to the TypeScript DO server anyway — the hard part is the design, not the syntax, and agents write the TS.

### Also considered, briefly
- **PlayCanvas**: great web engine + collaborative editor, but the editor is a hosted SaaS around which agent workflows are awkward, and it shares B's "second 3D stack" cost.
- **Phaser or 2D top-down**: cheapest option of all; but the repo's 3D assets and pipeline make low-poly 3D barely more expensive than good 2D, and 3D matches the "second world" ambition. A 3D world with a **fixed RS-classic camera** captures most 2D simplicity anyway.

## 4) Recommendation

**Option A**: a Three.js + TypeScript open-world client, served as a **second Cloudflare Worker deployable** in this repo, with an **authoritative 600 ms-tick world server on Durable Objects**, sharing the existing D1 database, JWT auth, `src/engine/` rules, `src/data/` content, and the R2 model pipeline.

Adopt the RSPS/Lost City interaction model wholesale — it's proven, latency-tolerant, and agent-buildable:
- Client sends intents ("walk to tile", "mine rock X", "attack NPC Y") the moment the player taps.
- Server resolves everything on the tick and broadcasts compact zone updates.
- Client renders and interpolates. No physics, no prediction, no rollback.

**Server-authoritative from day 1** for the world game (unlike PocketRPG's deliberate client-trusted save blob, §14 of CLAUDE.md). It must be, since multiplayer is the destination — and it means world-earned XP/items enter the shared character through audited server-side grants, which *raises* overall economy integrity rather than widening the trusted surface.

## 5) Shared-character architecture

**Identity**: same account, same JWT (`JWT_SECRET` set on both deployables), same `characters` rows. Since the token lives in localStorage (per-origin), add a tiny handoff: PocketRPG's "Enter the world" button calls `/api/world-token` (new endpoint) for a short-lived one-time code, opens `world.pocketrpg.co.uk#code=…`, and the world app exchanges it for the session JWT. (Standard cross-subdomain SSO; ~a day of work.)

**Character data — ownership rules (the critical design decision):**
- **Skills/XP**: single source of truth stays the existing save. The world server *reads* current XP at session start and *grants* XP via a new server-authoritative endpoint family (`/api/world/grant`, mirroring `/api/actions/**`: idempotent, audited via `functions/_lib/game/audit.js`). PocketRPG sees the new XP on next load/sync — "mine in the world, smelt idle in PocketRPG" works immediately.
- **Items/coins**: same pattern — world loot is granted server-side into the shared inventory/bank, exactly like boss uniques are today. The world server never edits the save blob directly.
- **Concurrent play**: reuse the **PvP save-lockdown pattern** — an active world session sets a lock so `/api/save` writes from an idle client can't clobber world grants mid-session (or, v1-simpler: entering the world just requires the idle game's pending state to be synced first, and grants are additive deltas so ordering barely matters).
- **World-only state** (position, current zone, world quest flags): lives in new D1 tables + per-zone DO storage, *outside* the save blob, like `character_daily_tasks` already does.

## 6) Repo & deployment shape

```
pocketRPG/
├─ src/, functions/, migrations/, …      # existing idle game (Pages project "pocketrpg", unchanged)
├─ world/
│  ├─ wrangler.jsonc                     # 2nd deployable: Worker "pocketrpg-world"
│  │                                     #   [assets] → world/dist, DO binding WORLD_ZONE,
│  │                                     #   same D1 database_id, same R2 bucket, JWT_SECRET
│  ├─ client/                            # Vite + TS + Three.js (standard Vite build —
│  │                                     #   no single-file concat, no §12 constraints)
│  ├─ server/                            # Worker entry + ZoneObject (Durable Object):
│  │                                     #   WebSocket hibernation, 600ms alarm tick loop,
│  │                                     #   imports ../../src/engine/* and ../../src/data/*
│  └─ shared/                            # protocol types (client↔server messages), zone defs
```

- **Two deploy pipelines, one repo**: the world Worker gets its own CI build with watch paths on `world/**` + `src/engine/**` + `src/data/**`; the existing Pages project ignores `world/**`. Preview deployments per branch work on both, same as today.
- **Domain**: `world.pocketrpg.co.uk` (CNAME to the Worker). Idle game stays at `pocketrpg.co.uk`.
- **Costs**: Workers Paid ($5/mo) for headroom; SQLite-backed DOs now have a free tier, and WebSocket Hibernation means an idle world costs ~nothing. R2/D1 already provisioned. **No new vendors, no servers to patch.**
- **Freedom from §12**: the world client is a normal Vite ES-module app — none of the single-file/classic-script/duplicate-identifier constraints apply. It bundles three.js as a module import (keep `public/vendor/three/` untouched for the idle game).

### Server load & cost model (write amplification)

The tick loop must never translate into per-tick durable writes. Three different things get conflated here — they have wildly different costs and the design treats them differently ([DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)):

1. **Intents = WebSocket messages, not writes — and they're event-driven, not per-tick.** The RS protocol is "one tap, one packet": *walk to tile X* or *mine rock Y* is sent once, and the server repeats the action every tick until it completes or is interrupted. Active play is ~5–15 messages/min/player, not 100. Even so, incoming WS messages are billed as requests at a **20:1 ratio** ($0.15/million requests after the included 1M/mo) and **outgoing messages are free** — so the per-tick zone broadcasts cost nothing.
2. **Per-tick simulation runs in DO memory — zero durable writes per tick.** While ≥1 player is in a zone the DO stays awake on an in-memory `setInterval` (no hibernation, no per-tick alarms) and mutates in-memory state; ticks with no active entities are skipped (Lost City does the same). The cost of "awake" is duration: 0.125 GB × $12.50/M GB-s ≈ **$0.0056 per zone-hour**, independent of how much happens inside it. Empty zones stop the ticker and hibernate → $0.
3. **Durable writes are checkpoints and grants, both coarse.** DO storage: zone/position snapshot every ~30–60 s and on every join/leave (≈60–120 row-writes/zone-hour). D1: XP/loot deltas are **batched per player** — flushed on bank/deposit, zone exit, logout, or a 60 s timer, each with an idempotency key + audit row, mirroring the daily-tasks pattern. Worst case ≈ 60 D1 writes/player-hour. A crash between checkpoints loses ≤60 s of *position* only — grants are transactional, so progression is never lost or duplicated.

**Worked example — 10 players, 1 hour, one zone**: duration $0.0056 + ~6,000 incoming messages ≈ 300 billed requests ($0.00005) + ~120 DO snapshot writes + ~600 D1 rows (within the 50M/mo included on paid) ≈ **about one cent**. Scaling: 100 concurrent across 10 zones, 10 h/day, 30 days ≈ 3,000 zone-hours ≈ $17/mo duration + ~$2 D1 — still trivially inside hobby budget. The per-message and per-write economics stay linear; the design guardrail to preserve them is simply *never persist per tick, never send an intent per tick* (enforce server-side: rate-limit intents per connection, coalesce zone diffs into one outgoing message per player per tick).

## 7) Phased plan (each phase ships something playable)

> **Superseded for execution (2026-07-09):** the authoritative, step-by-step build spec is **`docs/open-world-build-guide.md`**. Key changes decided there: combat (one monster — Pasture Bull — with floor loot and pickup) moves up to **Phase 2**, immediately after Phase 0 (auth+movement) and Phase 1 (Mining reflected in PocketRPG); input is OSRS-style left/right-click point-and-click, **desktop + tablet only** (no mobile in v1). The outline below is kept for the longer-horizon phases only.

**Phase 0 — Walking skeleton (the risk-killer).** Second deployable live at `world.pocketrpg.co.uk`: token handoff from PocketRPG, load your character (name + stats from D1), walk your existing `hero.glb` around one small hand-authored zone (tile grid, click/tap-to-move, A* path, fixed RS-style camera, run/walk animations already retargeted). Server: one DO zone, WebSocket connect, server-validated movement on the 600 ms tick. *Everything risky — auth handoff, DO tick loop, GLB on mobile, deploy split — is proven here before any gameplay exists.*

**Phase 1 — First skill: Mining.** Rock nodes placed in the zone (reuse ore/pickaxe defs from `src/data/items.json` + existing mining tables in `src/engine/`). Tap rock → walk over → mining animation → server rolls success per tick with the same formulas the idle game uses → `/api/world/grant` adds XP + ore to the shared character. **Milestone: mine in the world, watch the Mining level move in PocketRPG.** Inventory cap 28 applies; full inventory → "deposit" at a bank chest (grants to shared bank).

**Phase 2 — Second skill + interop loops.** Woodcutting (trees, respawns) or Smithing at a forge; PocketRPG idle tasks can consume world-mined ore and vice versa. Add the reverse hook: a "travel to the world" affordance inside PocketRPG's world map.

**Phase 3 — Combat.** Visible monsters (models already in `equipmentModels.json` `monsters` registry) with tick combat driven by the *same* `src/engine/combat.js` math — max hit, accuracy, styles, food/combo rules all identical to §4/§6 by construction. Death → respawn at zone entrance (decide death-cost rules before shipping). Loot via server-side drop rolls (already the `/api/actions` pattern).

**Phase 4 — Other players.** The DO already knows everyone in the zone: broadcast positions/appearances (equipment → model registry), name plates, local chat. Interest management = the zone itself at first; players are ghosts (no collision, no trading) in v1.

**Phase 5+ — Depth.** More zones (one DO each, door/edge transitions), quests as world journeys, group bosses, world events synced with PocketRPG dailies, eventually opt-in PvP zones reusing `pvpEngine`.

Sequencing note: Phases 0–2 are effectively single-player online (one player per zone instance is fine at first — spin the DO per character if simpler, then merge into shared zones in Phase 4). That keeps early phases small without ever building throwaway architecture, because the DO/WebSocket/tick shape is identical either way.

## 8) Build on existing open source — don't start from scratch

> Decision update (2026-07-09): the C# constraint is dropped; the stack is TypeScript end-to-end. Option E is dead. What follows is the reuse strategy that replaces "recreate everything".

Adopting a whole framework (RPG JS, Kaetram, Colyseus-hosted-Node) is the wrong kind of reuse here — each owns its own server runtime, world format, and account model, and the entire point of this project is that *PocketRPG's* engine, content, auth, and D1 are the platform. So reuse happens at three tiers:

### Tier 1 — Direct dependencies (code we install and ship)
- **[partyserver](https://github.com/threepointone/partyserver) + [partysocket](https://www.npmjs.com/package/partyserver)** (MIT, maintained by Cloudflare — [PartyKit was acquired by Cloudflare](https://blog.cloudflare.com/cloudflare-acquires-partykit/)). This is PartyKit's core rebuilt as plain libraries for your own Workers account: a `Server` class on Durable Objects with WebSocket lifecycle, **hibernation support, broadcast, per-room routing**, and a client socket with auto-reconnection and buffering. It deletes the lowest-level ~2–3 weeks of plumbing (connection management, room addressing, reconnect edge cases) and is exactly the "rooms = zones" shape we designed. The world `ZoneObject` becomes a `partyserver` subclass; the game tick and rules stay ours.
- **three.js** (already vendored) + its loaders; **`pathfinding`** npm (or ~100 lines of grid A* — tile-grid pathfinding is deliberately trivial in this design).
- **Existing repo code**: `src/engine/*` (combat, XP, consumables, drops), `src/data/*.json` (items, monsters, prayers), `src/utils/three3d.js` loading patterns, the R2 model pipeline + `scripts/retarget-animations.mjs`.

### Tier 2 — Reference implementations (read and adapt, don't depend on)
- **[LostCityRS / 2004Scape Server](https://github.com/2004Scape/Server) — MIT licensed, written from scratch in TypeScript.** This is the single most valuable resource found: a complete, running RS-2004 server in our exact language with the exact architecture we're building — 600 ms tick engine, action/interaction queues, player+NPC info (interest management), tile pathfinding, zone/region partitioning. MIT means we can study it freely and lift isolated algorithms with attribution. Its matching **[Client2](https://github.com/2004Scape/Client2)** (Java→TS/WASM port) shows browser-side tick interpolation and input handling. **Hard boundary: code only.** Their *content* — caches, maps, models, item/NPC data — is Jagex IP recovered for preservation and must never enter this repo; PocketRPG's own fantasy content and CC0 art fill that role (we already practice this discipline with naming).
- **[Kaetram-Open](https://github.com/Kaetram/Kaetram-Open)** (2D BrowserQuest descendant, actively maintained): clean, readable full-MMO loop in TS — regions, combat, multi-server hub — good second reference where Lost City is too RS-specific.
- **[Colyseus](https://docs.colyseus.io/)** (MIT): not adopted (it requires stateful Node hosting, off our Cloudflare path), but its [state-sync docs](https://docs.colyseus.io/state) are the best written material on delta-sync patterns if our zone snapshots ever need to get smarter than "send what changed each tick".

### Tier 3 — Content: CC0 art packs (the biggest "from scratch" saving of all)
The environment/NPC art for entire zones exists ready-made, license-free, in exactly the low-poly style that suits an RS-like and mobile GPUs:
- **[KayKit packs](https://kaylousberg.itch.io/kaykit-adventurers)** (CC0, glTF): rigged characters (Adventurers, [Skeletons](https://kaylousberg.itch.io/kaykit-skeletons)), a **[75-animation character pack](https://kaylousberg.itch.io/kaykit-character-animations)** (idle/walk/run/melee/death — the whole Phase 0–3 animation budget), dungeon/village/nature environment sets. Single small atlas textures, explicitly mobile-friendly.
- **[Quaternius](https://quaternius.com/)** (CC0): enormous rigged monster/character/nature/RPG-item libraries in glTF.
- **[Kenney](https://kenney.nl/)** (CC0): props, UI, effects.
These flow through the existing import pipeline (`npm run import:model`, retargeting, R2) — and CC0 means no attribution/licensing bookkeeping ever. The Tripo bridge (§18 of CLAUDE.md) remains available for bespoke hero/boss pieces.

### What's genuinely left to build (the thin custom core)
1. Zone data format + one authoring script (tile grid, walkability, node/NPC placements — JSON, same authoring style as `world.json`).
2. The tick resolver inside `ZoneObject`: apply queued intents → run `src/engine` rules → emit zone diff (this *is* the game; Lost City is the worked example).
3. `/api/world/grant` + world-token handoff (small, mirrors existing `/api/actions/**` + daily-tasks patterns).
4. The Three.js scene shell: camera, tap-to-move, entity meshes, animation switching (repo already contains working versions of most of these pieces in the equip viewer / combat arena).

## 9) Risks & mitigations

| Risk | Mitigation |
|---|---|
| Scope creep (open-world games are bottomless) | RS-classic aesthetic: low-poly, fixed camera, tile grid, tick actions. Phase gates above; each phase is shippable and small. |
| Art/content volume | Pipeline exists (Tripo import, R2, variants, retargeting). One zone + a handful of node/monster types per phase. |
| Mobile perf | Low-poly GLBs, draw-call budget per zone, `three.module.min.js` core, stream assets from R2; test on real phones from Phase 0. |
| Economy exploits across two games | All world grants server-authoritative + audited from day 1; world never writes the save blob; idempotency keys like daily tasks. |
| Engine-sharing drift (idle vs world importing same modules) | `src/engine` is already dual-consumed (client + Pages Functions); add world-server imports to the same Vitest suite. |
| DO limits (CPU per tick, zone population) | RSPS-scale ticks are cheap; shard per zone; hibernation for idle zones; proven pattern (Lost City on one Node thread). |
| Solo dev bandwidth | Agent-first stack (all TS, all text), same repo conventions, CLAUDE.md §-style rules for `world/**` once Phase 0 lands. |

## 10) What about C#? (resolved)

Dropped by decision on 2026-07-09 — the stack is TypeScript end-to-end. For the record: Godot can't ship C# to the web, Unity walls the game off from the shared engine/data and from agent-driven development, and a standalone .NET server (Option E) forks the game rules into a second language at the exact seam that must never drift. Backend design instincts (tick loop, protocol, state ownership, idempotent grants, audit) transfer 1:1 to the TypeScript Durable Object.

## 11) Sources

- [RuneScape Wiki — NXT (HTML5 client history)](https://runescape.wiki/w/NXT) · [Dev blog: NXT platforms](https://runescape.wiki/w/Update:Dev_Blog_-_NXT_-_Platforms_for_RuneScape)
- [2004Scape/Server (TS server)](https://github.com/2004Scape/Server) · [2004Scape/Client2 (Java→TS/WASM client)](https://github.com/2004Scape/Client2) · [Lost City](https://2004.lostcity.rs/) · [Rune-Server: TS/WASM webclient](https://rune-server.org/threads/rs2-webclients-typescript-webassembly.706021/)
- [Rune-Server: 600 ms tick & protocol](https://rune-server.org/threads/question-about-the-0-6sec-tick-and-the-protocol.674947/) · [RSPS wiki: OSRS protocol](https://rsps.fandom.com/wiki/OSRS_Protocol) · [RSProt networking library](https://rsps.org/news/rsprot-osrs-networking-library)
- [Genfanad Kickstarter FAQ](https://www.kickstarter.com/projects/rosetintedgames/genfanad/faqs) · [HN: indie browser MMORPG](https://news.ycombinator.com/item?id=40802557) · [Ironbane on three.js forum](https://discourse.threejs.org/t/ironbane-the-mmo-game-you-can-play-right-in-the-browser/48552)
- [Cloudflare DO WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) · [WebSocket hibernation example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/) · [CF blog: realtime games on Workers/DOs](https://blog.cloudflare.com/building-real-time-games-using-workers-durable-objects-and-unity/) · [CF monorepo docs](https://developers.cloudflare.com/pages/configuration/monorepos/) · [Workers advanced setups](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)
- [Godot: C# platform state](https://godotengine.org/article/platform-state-in-csharp-for-godot-4-2/) · [Godot forum: C# web export status](https://forum.godotengine.org/t/is-there-an-update-on-exporting-c-projects-to-web/128821)
- [Unity web runtime updates (mobile browsers)](https://unity.com/blog/engine-platform/web-runtime-updates-enhance-browser-experience) · [Unity forum: 50 MB phone build ceiling](https://discussions.unity.com/t/unity-6-webgl-build-size-limit-for-phones-is-50mb/948431)
- [Engine comparison: Three.js/Babylon/PlayCanvas](https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison) · [Melvor Idle](https://melvoridle.com/)
- [partyserver (MIT, Cloudflare)](https://github.com/threepointone/partyserver) · [Cloudflare acquires PartyKit](https://blog.cloudflare.com/cloudflare-acquires-partykit/) · [Colyseus state sync docs](https://docs.colyseus.io/state) · [Kaetram-Open](https://github.com/Kaetram/Kaetram-Open) · [RPG JS](https://rpgjs.dev/)
- [KayKit Adventurers (CC0)](https://kaylousberg.itch.io/kaykit-adventurers) · [KayKit Character Animations (CC0)](https://kaylousberg.itch.io/kaykit-character-animations) · [Quaternius (CC0)](https://quaternius.com/) · [2004Scape open-source-code thread (MIT licensing)](https://lostcity.rs/t/open-source-code/8472)
