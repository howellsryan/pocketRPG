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
- **M1 — merge prototype. ✅ Built.** `pasture + lumbright + forest` fused into ONE contiguous zone `overworld` (192×64) by `world/scripts/gen-merged-overworld.mjs` — internal portals gone, walkable wilderness between the places, only the `lumbright→varrick` edge kept (the hybrid escape hatch). Renders through the existing pipeline (screenshot-verified) and is served by the normal `WorldZone` DO. AOI broadcast added and **zone-gated** (`aoiRadius`): a player receives diffs only for entities within radius, with enter/leave tracked like loot (`server/aoi.ts`, `computeAoi`); absent on every other zone, so the per-zone game is byte-identical. See §"M1 results" below.
- **M2 — client streaming. ✅ Built.** The ground now builds as a grid of independent chunk meshes (`client/src/chunkedTerrain.ts`, 32-tile chunks) instead of one map-sized plane + one map-sized canvas, so the client only holds the chunks near a centre and map *size* stops bounding client cost. Threshold-gated in `terrain.ts` (>128 tiles either axis chunks; every live zone ≤96 keeps the single-mesh path byte-identically). Each chunk is `frustumCulled` so off-camera chunks are skipped. The scheduling half — `activeChunks`/`diffChunks` (which chunks are live, what enters/leaves as the centre moves) — is pure and unit-tested, mirroring the AOI enter/leave diff. See §"M2 results" below.
- **M3 — overworld layout. ✅ Built (skeleton).** All 14 canonical places now sit on ONE map (`zones/overworld.json`, 348×213) at their real map-board positions from `src/data/world.json`, linked by wilderness dirt roads following the game's travel-edge graph — the physical geography that replaces the per-zone W4 authoring pass. Hybrid: Lumbright (starter) is stamped inline and walkable, Varrick (capital) stays a portal, the other 12 are prop-marked district block-outs to be dressed into full towns by the visual track. Layout projection (`scripts/overworldLayout.mjs`) is pure + unit-tested; the generator (`scripts/gen-overworld.mjs`) self-validates reachability of all 14. See §"M3 results" below.
- **M4 — scale decision.** Keep single-DO+AOI if concurrency stays migla-scale; escalate to chunk-DOs only if load demands it. Interiors/dungeons stay instanced throughout.

## Roadmap impact — the decision to make now

The only near-term fork: **W1d "repaint the existing separate zones" and W4 "author 14 separate zones"** assume the per-zone model. If we commit to unification, that authoring should target *districts of one map* instead, or those zones get merged later. Everything else in the visual track (ground paint, building synthesis, editor) is model-agnostic and proceeds regardless.

Two sane orders:
- **A — Visual-first (recommended):** finish building synthesis + editor tools on the current zones, ship the quality win now, then start the M1 merge prototype. Lowest risk; value ships continuously; unification informed by a real prototype.
- **B — Unify-first:** start the M1 merge prototype now, before more per-zone authoring, so no zone dressing is thrown away. Higher risk (architecture before the visual tools are done), but avoids redoing any per-place authoring.

## M1 results (2026-07)

**What shipped.** `world/scripts/gen-merged-overworld.mjs` composes the three zones into `world/zones/overworld.json`: a 192×64 map, west→east lumbright · pasture · forest, each place's collision/objects/npcs/props/ground/ambient stamped at an offset (ids namespaced), the gaps left as walkable wilderness with dirt roads linking the former gate gaps. It registers in `server/zones.ts` (validated at module load) and `client/src/preview/main.ts`. AOI lives in `server/aoi.ts` (`computeAoi`, unit-tested) and is wired into `WorldZone.broadcastDiffs` behind the `aoiRadius` gate.

**Thesis check.** Renders as one contiguous world with all three places' streets, buildings, hens/frogs and chimney smoke on it — the client loads the whole 12k-tile mesh without trouble, confirming the merged-map render path works on the existing pipeline. One `WorldZone` DO serves it exactly like any zone.

**Known AOI limitation (prototype).** `computeAoi` diffs off the per-tick changed set plus a full diff for entities *entering* range; a far entity that never emits a diff would only re-appear on its next change. NPCs tick/wander and players move, so this is a non-issue in practice, but a full periodic snapshot per AOI cell is the M2-adjacent hardening if it ever bites.

**Bot-load check — procedure (needs live infra).** Not runnable in CI (a real load test needs `wrangler dev` + a `JWT_SECRET` + D1 + many authed WebSocket clients). To run it locally: seed a character (`npm run dev:seed`), start `wrangler dev`, then open N authed sockets to `/parties/zone/overworld` sending `{t:'hello',token}` and a walk loop, and watch the DO's tick duration (add a `console.log` around the `tick()` body) stay under 600 ms as N climbs. Expected outcome for migla-scale (tens–low-hundreds concurrent): comfortable, since the merged map has only ~9 NPCs and AOI caps per-player broadcast. Escalating past that is the **M4** chunk-DO decision, not M1.

**Next (M2).** Chunked terrain/prop streaming + culling so map *size* stops bounding the client — the prerequisite for a full 14-place overworld (M3) and for the deferred editor heightmap brush.

## M2 results (2026-07)

**What shipped.** `client/src/chunkedTerrain.ts` splits a large map's ground into a grid of 32-tile chunk meshes. Pure, unit-tested scheduling: `chunkGridDims`/`chunkTileBounds` (grid + clamped edge chunks), `activeChunks(centre, radius)` (Chebyshev window, clamped), `diffChunks(prev, next)` (the streaming build/dispose sets). The runtime `createChunkedTerrain` builds a chunk on enter (`scene.createGroundChunk` — one bounded plane + its own texture slice, or a shared terrain-preset material) and disposes it (geometry + owned texture) on leave, exposing `setCentre(x,z,radius)` and `pickTargets()`. `terrain.createTerrain` gates on a 128-tile threshold: bigger maps chunk, the ≤96 live zones stay on the single-mesh `createGround` path unchanged.

**Thesis check (screenshot-verified).** The 192×64 overworld (a 6×2 chunk grid) renders as one seamless landmass — no visible chunk cracks. Two things make the seams invisible: adjacent chunks read the same global corner heights at their shared edge (so displaced geometry lines up exactly), and the meadow preset material colours by world-space height/xz (so the blend and hash noise are continuous across chunk borders). Chunking is therefore visually transparent — it changes how the mesh is *built*, not how it *looks* — which is the acceptance bar for a streaming refactor. `frustumCulled=true` per chunk gives real off-camera culling for free.

**Scope boundary (live integration).** The chunk *manager* and its streaming diff are built and tested, and the preview renders the full map through them (centre = map middle, radius spanning the grid). Driving `setCentre` from a moving player, raycasting picks across the live chunk set, and chunk-bucketing scatter/props are the **live-integration** steps — needed only once the overworld becomes a real player destination. The live 5 zones don't touch any of this. True multi-resolution LOD (far chunks at lower vertex density) is a later optimization (M2b); distance streaming already delivers the size-independence M2 set out to prove.

## M3 results (2026-07)

**What shipped.** One overworld map holding all 14 canonical places, laid out from the data the idle game already owns. `scripts/overworldLayout.mjs` (pure, unit-tested) projects each place's `(x,y)` on the `world.json` 1640×879 map board to overworld tiles (`projectPlaces`, scale 0.32) and turns the 20-edge travel graph into stepped dirt-road rects (`roadSegments`) — so the 3D world's geography *is* the map players read, not invented coordinates. `scripts/gen-overworld.mjs` composes the zone (348×213) and fails fast on dims, in-bounds, unique ids, no-overlap with the Lumbright stamp, and foot-reachability of every one of the 14 district centres from spawn. Supersedes the M1 merge prototype (`gen-merged-overworld.mjs` removed; M1 is recorded above).

**Hybrid, three treatments.** Lumbright (the `start` town) is stamped **inline** — its full collision/objects/npcs/props/ambient, its own spawn landing on its district centre, so players begin in a real walkable town. Varrick (the capital, an authored 96² zone) stays a **portal** at its district — the hybrid escape hatch keeps the big instanced city off the shared map. The other 12 places are procedurally **dressed into towns** by `dressTown` (gen-overworld.mjs): a central plaza + cobbled street spokes, a ring of houses facing the centre, a fountain/well civic heart, ambient hens + chimney smoke, and **interactive facility stations driven by each place's `world.json` facilities** — bank→bank_chest, furnace_anvil→furnace+anvil, stove→range (sawmill/altar → landmark props, no engine object type yet). Tier-scaled (village r5 · town r7 · city r9), unwalled (walls stay Varrick's showpiece), and every station sits on a re-cleared cardinal lane so it can't be walled in. This is what M3 "replaces the per-zone W4 pass" means — authoring now targets districts of one map. Per-town bespoke landmarks remain for later editor polish.

**Thesis check (screenshot-verified).** The map reads as a recognisable region: Lumbright walled in the centre, a dozen settlement markers spread to their board positions, and the dirt-road network fanning between them along the real travel edges — the same topology as the idle map. The 348×213 map renders seamlessly through M2's chunked terrain, so M3 also stands as M2's real-world exercise (a 12×7 chunk grid, not the 192×64 prototype). A structural test recomputes the projection and asserts open ground at all 14 positions, so `world.json` and the emitted zone can't silently drift.

**Town dressing (track a). ✅ Done.** All 12 districts are now dressed towns (see "Hybrid, three treatments" above) — a structural test recomputes the layout and asserts every `world.json` facility appears as its station object near the district, walkable, so data and zone can't drift. Bespoke per-town landmarks/quests remain incremental editor polish.

**Next (track b — live integration).** Make the overworld a real player destination: wire the chunk manager's `setCentre` to player movement, picks across live chunks, scatter/prop chunk-bucketing, and a travel-design pass (teleport pads for a 348-tile map). The 14 zoneless places also each need an instanced interior/zone before their district can become a portal like Varrick's.
