# One Contiguous World Map — Investigation

> Should the open-world client move from many small portal-linked zones to ONE large continuous map holding every place (migla's model)? Written 2026-07-19, companion to `docs/world-design-review-2026-07.md`. Investigation + recommendation — no code.

## TL;DR

**Yes as the long-term target, via a hybrid: one streamed overworld + instanced interiors/dungeons.** It matches the migla reference the user admires and the "realistic 3D world" goal. But it is a multi-track rearchitecture (server area-of-interest, client chunk-streaming/LOD, map authoring at scale, travel design) with a real Cloudflare-specific scaling risk. It must **not** block the ground-paint/building/editor visual track, which pays off on one big map exactly as much as on many small ones. Recommended sequence: finish the visual track on the current per-zone model, prototype a 2–3 zone merge to de-risk, then commit to the full overworld.

## Where we are now

- **Per-zone islands.** 5 zones (`pasture`, `forest`, `lumbright`, `varrick`, `varrick_dungeon`), each a `ZoneDef` with its own ASCII collision grid (32×32 → 96×96 tiles), linked by `exits[]` portals.
- **One Durable Object per zone.** `WorldZone` is keyed by zone id (partyserver routes `/parties/zone/<id>`). Players in different zones never see each other; each occupied DO runs its own 600 ms tick loop. This **shards load by zone** — the reason the model exists.
- **A\* max path 64 tiles**, walk 1 / run 2 tiles per tick.
- **The idle game's geography is a graph, not a map.** `src/data/world.json` is 14 places connected by travel *times* (journeys) and teleports — there are no physical inter-place coordinates. The open world mirrors places as zones; the two products are already parallel, not one system.

## What "one map" changes

### 1. Server — the load model inverts
One contiguous map = one authoritative simulation holding all players + NPCs. migla does this, but its server is **Rust**, not a Worker. A single Cloudflare DO is single-threaded, ~128 MB, and our tick loop runs *inside* it — ticking hundreds of NPCs and broadcasting to hundreds of players from one DO is exactly the workload DOs scale worst at, and is why we sharded per zone.

Two viable shapes:
- **Single world DO + area-of-interest (AOI):** only simulate/broadcast entities near each player. Simplest to author; hard ceiling at one DO's CPU. Fine for a small shared world (migla-scale, tens–low-hundreds concurrent), not for mass scale.
- **Chunk-DO grid:** the map is tiles of one coordinate space, each chunk its own DO, with seamless visibility + entity handoff at borders. Scales, but border-crossing visibility and cross-chunk pathfinding are a large, bug-prone build.

### 2. Client — streaming becomes mandatory
Today the client loads the whole zone mesh at once (fine at 9k tiles). A world spanning 14 places is plausibly 512×512+ (262k tiles): collision alone is ~256 KB of strings, and terrain/scatter/props scale with area. Mobile cannot render that at once. Required: **chunked terrain streaming, prop/scatter frustum-culling, LOD** — the single biggest client rework, and net-new (the terrain plan assumed bounded per-zone meshes).

### 3. Travel design
Crossing 512 tiles at run speed ≈ 256 ticks ≈ 2.5 min — tedious. migla keeps its world deliberately "small" (256×256). A big map needs teleport pads (the idle game already defines teleports in `world.json`), mounts, or run-everywhere plus generous spacing. This is a design decision, not just code.

### 4. Interiors stay instanced (this is the escape hatch)
Every seamless-world MMO still instances dungeons and building interiors behind a door. So the realistic target is **hybrid**: one overworld map + `varrick_dungeon`-style interiors kept as separate DOs reached by portals. That keeps the hardest content (dense boss rooms) off the shared world DO and means the current zone/portal machinery is **reused, not discarded**.

### 5. The idle game is untouched
The overworld is its own physical coordinate space; place positions on it are new open-world data. `world.json`'s travel-time graph stays as-is for the idle game. No integrity-boundary or save-format contact. Good — this is purely an open-world-client rearchitecture.

## Recommendation

Target the **hybrid streamed overworld**, reached in de-risked steps rather than a big-bang rewrite:

- **M0 — visual track first (in flight).** Ground paint (shipped), building synthesis, editor tools. Every bit applies unchanged to one big map; none is wasted. This keeps shipping visible quality while the architecture is decided.
- **M1 — merge prototype.** Fuse `pasture + lumbright + forest` into ONE contiguous zone (no portals between them) in a single DO with AOI broadcast. Cheapest possible test of the whole thesis: does one DO tick a merged map acceptably, and does the client stay smooth? Screenshot + a bot-load check.
- **M2 — client streaming.** If M1 holds, add chunked terrain/prop streaming + culling so map size stops bounding the client.
- **M3 — overworld layout.** Define the physical coordinate positions of all 14 places + the wilderness between them; author as districts of one map (this replaces the per-zone W4 authoring pass).
- **M4 — scale decision.** Keep single-DO+AOI if concurrency stays migla-scale; escalate to chunk-DOs only if load demands it. Interiors/dungeons stay instanced throughout.

## Roadmap impact — the decision to make now

The only near-term fork: **W1d "repaint the existing separate zones" and W4 "author 14 separate zones"** assume the per-zone model. If we commit to unification, that authoring should target *districts of one map* instead, or those zones get merged later. Everything else in the visual track (ground paint, building synthesis, editor) is model-agnostic and proceeds regardless.

Two sane orders:
- **A — Visual-first (recommended):** finish building synthesis + editor tools on the current zones, ship the quality win now, then start the M1 merge prototype. Lowest risk; value ships continuously; unification informed by a real prototype.
- **B — Unify-first:** start the M1 merge prototype now, before more per-zone authoring, so no zone dressing is thrown away. Higher risk (architecture before the visual tools are done), but avoids redoing any per-place authoring.
