# Open-World Terrain — Plan, Rationale & Step-by-Step Guide

> How the open-world client (`world/`) moves from a flat checker plane to authored, world-class 3D terrain for every place a player can visit, by adapting techniques from [THREE.Terrain](https://github.com/IceCreamYou/THREE.Terrain) (MIT). Written 2026-07-13. Companion to `docs/open-world-companion-game-plan.md` and `docs/open-world-build-guide.md`.

## 0) TL;DR

- Today the ground is a single flat `PlaneGeometry` with a checker `CanvasTexture` (`world/client/src/scene.ts` `createGround`). It reads as a prototype, not a world.
- We drape an **authored heightmap** under the existing tile grid and paint it with a **slope/elevation-blended material**, then scatter **decorative flora** across it — three techniques lifted (not vendored wholesale) from THREE.Terrain.
- **The whole change is client-render-only.** The server stays tile-grid + flat authoritative movement. The single integration seam is one function — `heightAt(x, z)` — that every mesh adds to its Y.
- Terrain is authored **per zone as data** (a grayscale PNG + a small `terrain` block in the zone JSON), so it fits the existing data-authored zone model and the world editor.
- Delivered in six additive phases (T0–T5); every phase ships and the game stays playable throughout. Phase T4 is the per-place authoring pass that gives all 14 Eldermoor destinations bespoke terrain.

## 0.5) Implementation status (2026-07-13)

Landed on `claude/three-terrain-review-9214m7`, each phase gated by `world:check`
(see `docs/world-progress.md` "TERRAIN TRACK"):

- **T0 — height seam**: ✅ `scene.tileToWorld` consults a module-level sampler; flat until registered.
- **T1 — displaced mesh**: ✅ seeded procedural height (`terrain.ts`), displaced normal-lit ground. *(Deviation: procedural wired first — fully testable headless; authored heightmap PNGs land with the editor in T4.)*
- **T2 — blended material**: ✅ 7-preset elevation/slope colour blend (`terrainMaterials.ts`), texture-free. *(Texture-based blend with CC0 art is a later upgrade.)*
- **T3 — scatter**: ✅ seeded, mask-aware `InstancedMesh` flora (`scatter.ts`), reusing existing prop GLBs.
- **T4 — author places**: 🟡 partial — the 3 existing world zones (pasture/forest/lumbright) have terrain blocks; the other 11 places author once their zones exist.
- **T5 — editor/LOD/PNG import/water**: ⬜ not started (needs editor work + on-device perf).

Everything below is the original plan; §0.5 is the live checklist.

## 1) Where we are now

`world/client/src/scene.ts`:

- `createGround(scene, collision, width, height, palette)` builds **one flat `PlaneGeometry(width, height)`**, rotated to lie on XZ with its corner at the origin.
- The only surface detail is `buildGroundTexture` — a nearest-filtered checker canvas, one colour pair for walkable (`.`) tiles, a darker pair for blocked (`#`) tiles. Walkability is communicated *by the checker itself*.
- `tileToWorld(x, z)` returns `y = 0`. **Every** placed thing — hero, NPCs, props (`props.ts:38`), skilling statics (`statics.ts:241`), loot, exits — sits on the `y = 0` plane and adds a fixed local offset.
- Picking (`main.ts`) raycasts the flat ground; `worldToTile` floors the hit point to a tile.

It's correct and cheap, but it's a board, not a landscape. Zones are visually interchangeable; a desert, a marsh, and a coastal town all render as the same green-vs-brown checkerboard.

## 2) Why THREE.Terrain's techniques fit *here* (and not the idle game)

The idle-game arena rejected THREE.Terrain (flat disc, lazy classic-script three.js, §12 single-file constraints). The world client inverts every one of those:

| Constraint that blocked it in the idle game | In `world/client` |
|---|---|
| three.js lazy-loaded as classic scripts, `minifyIdentifiers:false`, §12 | Normal Vite ES-module app; `import * as THREE from 'three'` already in `scene.ts`. THREE.Terrain-style modules drop in. |
| Renders a fixed flat disc | Renders real 3D zones with a perspective camera — height is meaningful. |
| Deterministic tick core must not carry render code | Terrain is pure client render; server is tile logic. Zero integrity-boundary contact. |
| Mobile idle budget, no bundling | Still mobile-first, but a per-zone heightmap mesh + one blended material is a tiny, bounded cost. |

We **adapt three techniques**, we do **not** add the library as a dependency (it's a full `Mesh`/`Geometry` factory with LOD/water/import-export we don't need, and MIT lets us lift the ~40–80 lines that matter with attribution):

1. **Heightmap → displaced mesh** (their `fromHeightmap`): a grayscale image becomes vertex Y displacement.
2. **`generateBlendedMaterial`**: blend grass/dirt/rock/sand by elevation *and* slope in a GLSL `onBeforeCompile` hook.
3. **`ScatterMeshes`**: seeded, density- and slope-aware placement of decorative flora.

## 3) Core architectural decision — the `heightAt` seam

**Movement and collision stay flat and server-authoritative.** The tile grid, A\* pathfinding (`world/server/pathfind.ts`), wander boxes, and picking-to-tile all keep operating in the 2D `(x, z)` tile space exactly as today. The server never learns the ground has height. This preserves the entire §14-style integrity model and every existing test.

The client gains **one new per-zone function**:

```ts
// world/client/src/terrain.ts
export type HeightField = {
  heightAt(x: number, z: number): number   // world (x,z) → ground Y, bilinear
  mesh: THREE.Mesh                          // the displaced, blended ground
}
```

Integration rule: **anything that today copies `tileToWorld(x, z)` adds `heightAt(x, z)` to its Y.** That is the complete list of touch points — `entities.ts` (hero + NPCs + remote players), `props.ts`, `statics.ts`, `loot.ts`, exit markers, and the camera target in `main.ts`. `tileToWorld` stays the authority for X/Z; height is layered on top. Because `updateCamera` copies the hero's full position, the fixed-offset camera rises and falls with the terrain for free.

Constraints that keep the seam safe:

- **Low relief.** Authored height stays within roughly ±1.5 tiles so it never breaks top-down readability, never hides a pickable node behind a hill, and never desyncs visually from flat tile movement. Height is *scenery*, not gameplay geometry.
- **Height is a pure function of authored data**, identical on every client — no per-client RNG — so remote players and NPCs sit on the same ground everyone else sees.
- **Picking still works**: with the flat plane replaced by a segmented displaced mesh, `main.ts` raycasts the *terrain mesh* instead of the plane; the hit point's `(x, z)` still floors to the correct tile (`worldToTile` unchanged), because height only moves Y.

## 4) Data model — terrain as authored zone data

Extend `ZoneDef` (`world/shared/zone.ts`) with one optional block. Absent → today's flat plane, so **every existing zone keeps working unchanged**.

```ts
export type ZoneTerrain = {
  /** Grayscale heightmap under world/client/public/heightmaps/<id>.png,
   *  sized width×height (one texel per tile) or an integer multiple for
   *  sub-tile detail. Black = low, white = high. */
  heightmap?: string
  /** Procedural fallback when no heightmap is authored: seeded noise so a
   *  zone still gets gentle relief. Deterministic from (seed, zone id). */
  procedural?: { seed: number; amplitude: number; frequency: number }
  /** Peak vertical displacement in tiles (clamped ≤ ~1.5). */
  relief: number
  /** Named terrain material preset (see §5 table), e.g. "meadow", "desert". */
  material: string
  /** Optional decorative scatter layers (§7). */
  scatter?: ZoneScatterLayer[]
}

export type ZoneScatterLayer = {
  model: string        // GLB in world/client/public/models/nature/
  density: number      // props per 100 walkable tiles
  minSlope?: number    // skip steep faces (default: any)
  maxSlope?: number
  jitter?: number      // 0..1 position noise within a tile
  scaleRange?: [number, number]
}
```

`validateZone` gains matching checks: `relief` in `0..1.5`, `material` names a known preset, `heightmap`/`procedural` well-formed, scatter models resolvable. Terrain never references walkable tiles for gameplay — it's validated as pure decoration.

**Why authored PNG over pure procedural:** the plan is bespoke, hand-crafted zones matching the main app's geography (§6), not an infinite procedural world. A grayscale PNG is the most direct authoring surface — paint it in any image editor, or generate it once with THREE.Terrain's noise/diamond-square as a *starting point*, then hand-edit. `procedural` exists only as a zero-effort fallback so a new zone is never a dead-flat plane.

## 5) Terrain material presets

A registry (`world/client/src/terrainMaterials.ts`) of named presets, each a `generateBlendedMaterial`-style config: up to four CC0 textures (Kenney/KayKit — no THREE.Terrain demo assets) blended by elevation band and slope, plus tint and roughness. This is what makes a desert look like a desert instead of a recoloured checkerboard.

| Preset | Blend behaviour | Used by (see §6) |
|---|---|---|
| `meadow` | grass low → dirt on slopes → rock on peaks | Lumbright, Varrick, Faloden, Camlann |
| `woodland` | rich grass + leaf litter, mossy rock | Ardounne, Catherra |
| `highland` | grass → scree → bare rock, higher relief | Seerhold, Edgevale |
| `desert` | sand → dune shadow → sandstone | Al-Karid |
| `marsh` | wet mud → peat → reed banks, low relief, dark | Draynar, Canifel |
| `volcanic` | ash → basalt → cracked lava rock | Brimhollow |
| `coastal` | grass → sand → wet sand at the water edge | Port Sarin, Barlock |

Presets deliberately mirror the idle game's 3D arena biomes (`src/data/biomes3d.json`: meadow/desert/marsh/volcanic/umbral) so the two games share one visual language. Where biomes3d already maps a place (`alkarid→desert`, `brimhollow→volcanic`, `canifel/seerhold/draynar→marsh`) the terrain preset matches.

## 6) The destinations — a terrain preset for all 14 places

Every place in `src/data/world.json` becomes (or already is) a world zone. Target authored terrain:

| Place | Fantasy geography (from `world.json` lore + `PlaceArt.jsx` map) | Preset | Relief / signature |
|---|---|---|---|
| **Lumbright** | starter river town, cabbage fields, old castle | `meadow` | low; river channel cut, castle mound |
| **Varrick** | great city, central plains | `meadow` | low; broad flat with paved rise to the city |
| **Faloden** | river-bridge crossing | `meadow` | low; river valley, banked approaches to the bridge |
| **Ardounne** | western oakwood town | `woodland` | med; rolling wooded hills, oak scatter |
| **Draynar** | mistmarsh village | `marsh` | very low; boggy hollows, reed scatter, dark ambience |
| **Al-Karid** | southern desert gateway | `desert` | med; dunes, sandstone outcrops, agave scatter |
| **Edgevale** | frontier on the wilderness edge | `highland` | med-high; broken rocky ground, sparse dead scatter |
| **Barlock** | tropical/coastal port (Brimhaven analogue) | `coastal` | low; beach shelf, palm scatter |
| **Catherra** | loch-side fishing village | `woodland`/`coastal` | med; shoreline slope into the loch, pine + oak |
| **Seerhold** | highland pine seers' village | `highland` | high; pine ridges, exposed rock |
| **Brimhollow** | volcanic forge town | `volcanic` | med; basalt terraces, obsidian scatter, ember glow |
| **Canifel** | haunted marsh wood | `marsh` | low; sunken graves, dead-tree scatter, umbral tint |
| **Camlann** | loch by the mountains | `meadow` | med; lakeshore banks, foothill rise |
| **Port Sarin** | south-coast harbour | `coastal` | low; harbour flat dropping to the Sarin Sea |

Each place gets: a `terrain` block in its zone JSON, a hand-edited heightmap PNG, and 1–3 scatter layers. That is the whole per-place authoring recipe — repeatable, agent-drivable, no engine work after Phase T2.

## 7) Scatter — decoration only, never gameplay

Adapt THREE.Terrain's `ScatterMeshes` into a small seeded placer (`world/client/src/scatter.ts`):

- **Seeded per zone** (mulberry32 keyed by zone id) → identical on every client, stable across reloads, testable.
- **Masked against gameplay data**: never place on `#` blocked tiles, never on a tile occupied by an `object`/`npc`/`exit`, and respect `minSlope`/`maxSlope` so trees don't grow on cliffs. This mask is the critical rule — **interactive nodes stay server-authored `objects[]`; scatter is pure dressing with no collision and no pick target** (same contract as the existing `props[]`, `zone.ts:30`).
- **Instanced** (`THREE.InstancedMesh`) per model so a thousand grass tufts cost one draw call — the mobile-perf guardrail.
- Snapped to `heightAt(x, z)` so flora sits on the ground.

## 8) How it beats what we have

| Today | After |
|---|---|
| One flat plane, checker texture | Undulating authored terrain, slope/elevation-blended natural materials |
| Every zone visually identical | 7 distinct biome looks; 14 bespoke, recognisable places |
| Walkability shown by ugly checker | Walkability read from natural terrain + cliffs; checker becomes a dev-only debug toggle |
| Bare ground, props hand-placed one by one | Instanced flora scattered by density, thousands of props for ~free |
| No shared identity with the idle game | Terrain presets mirror `biomes3d.json` — one franchise look across both games |
| Nothing to author per zone | A repeatable PNG-plus-JSON recipe; new zones get terrain in minutes |

Crucially it delivers all this **without touching the server, the tick loop, pathfinding, the save/grant integrity model, or any existing test** — because of the §3 seam.

## 9) Step-by-step implementation guide

Each phase is independently shippable and gated by `npm run world:check` (typecheck + vitest + vite build). Follow the `open-world-build-guide.md` discipline: one step, verify, log to `docs/world-progress.md`.

### Phase T0 — The height seam (no visual change)
1. Add `world/client/src/terrain.ts` exporting a `HeightField` whose `heightAt` returns `0` and whose `mesh` is today's flat ground moved out of `scene.ts`.
2. Thread `heightAt` through every `tileToWorld` consumer: `entities.ts`, `props.ts`, `statics.ts`, `loot.ts`, exit markers, and the camera target in `main.ts`. Each adds `heightAt(x, z)` to its Y.
3. **Ship criterion:** pixel-identical to today (heightAt≡0), but the seam exists. Add `world/tests/terrain.test.ts` asserting `heightAt≡0` places everything exactly as before.

### Phase T1 — Heightmap terrain mesh
4. Extend `ZoneDef` with the `terrain` block (§4) + `validateZone` checks + tests (`world/tests/zone.test.ts`).
5. In `terrain.ts`, replace the flat plane with a segmented `PlaneGeometry(width, height, width*S, height*S)` (S = sub-tile subdivisions, start S=2). Displace each vertex Y by sampling the heightmap PNG (adapt THREE.Terrain `fromHeightmap`, bilinear), scaled by `relief`. Implement `heightAt` as the same bilinear sample so meshes and ground agree exactly.
6. Point `main.ts` picking at the terrain mesh; confirm `worldToTile` still returns correct tiles (height only moves Y).
7. Author one real heightmap (`pasture`) end to end as the reference.
8. **Ship criterion:** pasture has gentle relief; hero/NPCs/props/loot ride the surface; clicking still moves to the right tile; all `world` tests green.

### Phase T2 — Blended terrain material
9. Add `terrainMaterials.ts` with the §5 preset registry; import CC0 textures into `world/client/public/textures/terrain/`.
10. Build a `generateBlendedMaterial`-style `MeshStandardMaterial` + `onBeforeCompile` that blends the preset's textures by elevation band and slope (`dot(normal, up)`), with tint/roughness. Wire zone `terrain.material` → preset.
11. Retire the checker: replace `buildGroundTexture` with the blended material; keep the checker behind a `?debugGrid=1` dev flag for authoring.
12. Per-zone `ambience` (already in `ZoneDef`) tunes sky/light to match the preset.
13. **Ship criterion:** pasture reads as a real meadow; desert/marsh presets visibly differ on test zones.

### Phase T3 — Scatter dressing
14. Add `scatter.ts` (§7): seeded, mask-aware, slope-aware, `InstancedMesh` output. Import CC0 nature GLBs to `public/models/nature/`.
15. Wire `terrain.scatter[]` layers; snap instances to `heightAt`.
16. Tests: determinism (same seed → same positions), and the mask invariant (no instance on a blocked/occupied/exit tile) in `world/tests/scatter.test.ts`.
17. **Ship criterion:** pasture is dotted with grass/rocks/flowers; frame time on a mid phone stays within budget (§10).

### Phase T4 — Author all 14 places
18. For each place in §6: create/confirm its world zone, add its `terrain` block, hand-author its heightmap PNG (procedural noise as a starting point, then edit), pick its preset, add 1–3 scatter layers.
19. Match signatures from the §6 table (river channels, dunes, lakeshores, basalt terraces).
20. **Ship criterion:** every destination is visually distinct and recognisably itself; a screenshot pass (via the editor preview, §T5) reviewed per place.

### Phase T5 — Editor, LOD & polish
21. Extend the world editor (`world/client/src/editor/`) with a **heightmap brush** (raise/lower/smooth) writing the PNG, a preset picker, and a scatter-density slider — so terrain is authored in-tool, not in an external editor. (Note: `docs/world-editor-plan.md:76` lists heightmaps as out of scope — this phase **consciously reverses that** for the renderer while the editor's collision grid stays 2D.)
22. LOD/perf: cap subdivisions per zone by area; reduce far-tile detail; frustum-cull scatter chunks; verify the draw-call and frame-time budget on a real mid-range phone.
23. Optional water plane at a fixed sea level for `coastal` presets (a single translucent plane, not THREE.Terrain's water sim).
24. **Ship criterion:** a developer can author a new zone's terrain end-to-end in the editor; perf budget met on target hardware.

## 10) Guardrails (do not violate)

- **Client-render only.** Nothing in `terrain.ts`/`scatter.ts`/`terrainMaterials.ts` is imported by `world/server/**` or `src/engine/**`. Movement, collision, pathfinding, and grants stay flat and authoritative.
- **Height is decoration, ≤ ~1.5 tiles.** It must never hide a pickable node, break top-down readability, or diverge from flat tile movement.
- **Scatter never gates gameplay** and never lands on blocked/occupied/exit tiles.
- **Determinism**: terrain and scatter are pure functions of authored data + zone-id seed — identical on every client.
- **Content boundary**: CC0 textures/models only (Kenney/KayKit/Quaternius). No THREE.Terrain demo assets; adapt its algorithms with MIT attribution in the source header.
- **Mobile budget**: instanced scatter, capped subdivisions, one blended material per zone. Test on real phones from Phase T3.
- **Additive**: absent `terrain` block = today's flat plane. No existing zone or test breaks at any phase.

## 11) Risks

| Risk | Mitigation |
|---|---|
| Height desyncs picking or movement | Server stays flat/tile-based; height only moves render Y; raycast the real mesh; `worldToTile` unchanged and tested (T0/T1). |
| Perf regression on mobile | Instanced scatter, capped subdivisions, LOD, per-zone budget, real-device testing from T3. |
| Terrain hides a mining rock behind a hill | ≤1.5-tile relief cap + authoring review; nodes are top-lit and above the surface. |
| Authoring 14 heightmaps is slow | Procedural noise seeds each PNG; editor brush (T5); the recipe is PNG + preset + scatter, minutes per place. |
| Reversing the editor's "no heightmaps" scope line | Explicit decision in §T5; collision grid stays 2D, only the renderer drapes height. |

## 12) Sources

- [THREE.Terrain (MIT)](https://github.com/IceCreamYou/THREE.Terrain) — heightmap import, `generateBlendedMaterial`, `ScatterMeshes` (adapted, not vendored).
- `docs/open-world-companion-game-plan.md` (stack, reuse strategy, CC0 art), `docs/open-world-build-guide.md` (build discipline), `docs/world-editor-plan.md` (editor).
- `world/client/src/scene.ts`, `world/shared/zone.ts`, `src/data/biomes3d.json` (shared biome language).
- CC0 art: [Kenney](https://kenney.nl/), [KayKit](https://kaylousberg.itch.io/), [Quaternius](https://quaternius.com/).
