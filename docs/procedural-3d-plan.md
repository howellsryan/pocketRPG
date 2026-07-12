# Procedural 3D Generation — Design Plan

Goal: generate monsters, bosses, environments, weapons, armour, and animations as **pure three.js code driven by small JSON specs** — no external asset files. End state: an AI (or dev) writes a ~15-line spec, and a seamless, animated, hand-sculpted-looking creature appears in `CombatArena3D`. Coexists with the Tripo GLB pipeline (`equipmentModels.json`); replaces it per-entry as quality allows.

Status: **plan only** — nothing built. Each phase passes plan-gate separately before its first edit.

## 1) The core technique: SDF blend-shell

Reference: community-proven approach (procedural creature apps on r/threejs), grounded in standard SDF math ([Quilez, distance functions](https://iquilezles.org/articles/raymarchingdf/)).

A creature is a list of **SDF primitives** (capsules, cones, spheres — each with position/orientation, radii, color, blend radius). Rendering avoids both raymarching (per-pixel, mobile-hostile) and marching cubes (CPU, chunky):

1. **Coarse proxy meshes** — one low-poly `CapsuleGeometry`/`ConeGeometry` per primitive, merged into a single `BufferGeometry` (one draw call) with a per-vertex `primIndex` attribute.
2. **Vertex-shader projection** — each vertex is snapped onto the isosurface of the **smooth-min union** of all primitives: iterate `p -= f(p) · ∇f(p)` a few times. Overlapping shapes converge onto the same blended surface — seams cease to exist.
3. **Normals from the SDF gradient** (4-tap tetrahedral) — lighting flows continuously across joints.
4. **Color by SDF proximity** — per-primitive colors weighted by distance → soft gradients at every join, free.

Cost is **per-vertex, not per-pixel** (~2k verts × ~20 prims is trivial), so it is mobile-friendly. It is ordinary mesh rendering: no skinning, no raymarching, works with our existing scene/lights.

Robustness details to carry over: outlines project onto an SDF offset surface (not normal inflation — avoids concave-joint artifacts); fully-buried proxy geometry tucks under the skin; thin parts (antennae, horns) cap their blend radius so they don't dissolve into the body.

**Animation = moving the primitives.** Primitive transforms are the "bones": CPU updates them per frame (uniform array), the shell re-projects automatically, parts stay fused while moving. No clips, no rigs:
- Legged: reactive IK foot-stepping (same solver for 2/4/6 legs).
- Hoppers: squash-and-stretch state machine.
- Flyers: hover + bank.
- Tails/ears/tentacles: verlet rope segments that are themselves SDF primitives — they flop while staying seamlessly fused.

## 2) Architecture: greenfield first, existing infra as optional mount points

Deliberate stance: the current 3D setup (`CombatArena3D`, `Model3DViewer`, `equipmentModels.json`) is **not a design constraint**. It grew around loading GLBs — height-normalising foreign models, retargeting clips, R2 hosting. A pure-procedural world needs none of that, so the procedural system is designed standalone and the existing pieces plug into it, not vice versa.

**Greenfield core** — a self-contained procedural renderer (working name `src/3d/`):
- `procWorld.js` — owns scene, camera, lights, render loop, resize. Not borrowed from the arena.
- `blendShell.js` — spec → merged geometry + shell shader + primitive-transform buffer.
- `rigs.js` — locomotion archetypes, IK, verlet ropes, state machine.
- `biomes.js` (Phase 4) — ground, props, atmosphere from a biome spec.
- Specs in `src/data/creatures3d.json` (own file, own schema/version — not squeezed into `equipmentModels.json`).

**Existing infra becomes adapters, kept only while they earn it:**
- `CombatArena3D` shrinks to a thin host: mounts a `procWorld`, forwards combat events (attack tick, damage, death — the hooks it already has). Its GLB path survives as a legacy adapter per registry entry until procedural parity, then may be deleted.
- `loadThree()` gating (WebGL check, reduced-data, paper-doll fallback, `pocketEnable3D`) is genuinely good and provider-agnostic — reuse, don't rebuild.
- The single-file build rules (§12: chunk registration, eval-time TDZ) are repo law, not 3D architecture — they apply to whatever we write.

**Registry inversion (end state):** today GLB is the default and procedural would be the exception. Once Phase 2 lands, flip it — procedural spec is the default monster path (auto-enabling the arena exactly as GLB entries do today), GLB the opt-in exception for showpieces.

**Renderer options kept open:** three **r0.185** vendored, WebGL2 by default — `CapsuleGeometry`, data textures, ≥256 vertex uniform vectors (≈50+ primitives at 4 vec4; working cap 24 — confirm real `MAX_VERTEX_UNIFORM_VECTORS` in the spike). r185 also ships `WebGPURenderer` + TSL node materials; the blend-shell shader is small enough to port, so we write it as plain GLSL now but keep the SDF evaluation in one shared function to leave a TSL/WebGPU port cheap if we later want compute-shader projection or many-creature scenes (the open-world companion plan would). Decision deferred — not a spike blocker.

## 3) Spec format (target authoring surface)

One creature ≈ 15 lines of JSON. Sketch (schema finalised in Phase 1):

```json
{
  "archetype": "quadruped",
  "scale": 1.4,
  "palette": ["#6b4a2f", "#c9a86a", "#2e2620"],
  "parts": [
    { "shape": "capsule", "id": "body", "from": [0,0.9,-0.5], "to": [0,1.0,0.5], "r": 0.45, "color": 0 },
    { "shape": "capsule", "id": "head", "from": [0,1.1,0.6], "to": [0,1.15,0.95], "r": 0.28, "color": 1, "blend": 0.25 },
    { "shape": "cone", "id": "hornL", "from": [-0.12,1.35,0.8], "to": [-0.2,1.6,0.85], "r": 0.06, "color": 2, "blend": 0.05 },
    { "shape": "rope", "id": "tail", "anchor": [0,0.95,-0.55], "segments": 5, "r": 0.12, "taper": 0.4, "color": 0 }
  ],
  "legs": { "count": 4, "attach": "body", "gait": "trot" },
  "anim": { "idle": "breathe", "attack": "lunge", "hit": "flinch", "death": "collapse" }
}
```

`archetype` selects the locomotion rig; `parts` build the blend-shell; `palette` indexes keep specs terse and let look-dev retint whole creatures from `DESIGN.md`-derived region palettes.

## 4) Phases

Each phase is a separate gated task with its own plan; this is the roadmap, not the plans.

**Phase 0 — Spike (throwaway allowed).** Dev-only harness (standalone page or dev-gated `Model3DViewer` mode): 3–6 primitives, blend-shell shader, SDF normals, color blending, one animated primitive. Exit: seam-free screenshot; ≥50fps desktop; measured mobile FPS + `MAX_VERTEX_UNIFORM_VECTORS`; look-dev verdict against `DESIGN.md`. **Kill/adapt decision happens here.**

**Phase 1 — Greenfield runtime.** `src/3d/` core (`procWorld.js` + `blendShell.js`, chunk files): spec → living creature with `update(dt)`. `src/data/creatures3d.json` schema + validation tests. `CombatArena3D` mounts a `procWorld` when the monster has a spec (thin-host refactor can be partial — GLB path untouched). One live monster (rat/imp tier) behind the existing gate. Exit: renders in arena, paper-doll fallback intact, `npm run ci` + `check:single` green.

**Phase 2 — Procedural animation library.** Locomotion rigs (biped/quadruped/multi-leg IK stepping, hopper squash-stretch, flyer hover/bank, serpent), verlet ropes, and a state machine wired to the arena's existing combat hooks (idle/attack/hit/death). Exit: one creature per archetype demonstrably animating through all states.

**Phase 3 — Authoring loop (the payoff).** `procgen-creature` skill: spec conventions, palette rules, primitive budget, and a **screenshot verification harness** (`scripts/render-proc.mjs`, Playwright + preinstalled Chromium → PNG) so AI-authored specs are reviewed visually before commit — same generate-once-commit-reviewed philosophy as the Tripo pipeline. Exit: author a novel creature end-to-end via the skill in one session.

**Phase 4 — Environments.** Per-region arena set dressing from a biome spec: procedural ground material (noise shader), instanced props (rocks/trees/pillars from the same primitive vocabulary), fog + hemisphere-light palettes keyed to `world.json` regions. Exit: 2–3 visually distinct arena biomes.

**Phase 5 — Gear.** Procedural weapons/armour (`LatheGeometry`/`ExtrudeGeometry` profiles + palette materials) as an alternative in the `weapons`/`gear` registries; hero bone-attachment path unchanged. Exit: one procedural weapon equipped on the hero, visually acceptable next to Tripo pieces.

**Phase 6 — Bosses, raids, dungeons.** Multi-part bosses (larger primitive budgets, phase-driven part swaps), dungeon/raid set pieces, shader-time VFX (dissolve deaths, elemental glows). Sequenced last: it reuses everything above.

## 5) Risks

- **Art direction drift** — blend-shell reads "soft clay"; our brand is parchment fantasy. Mitigation: Phase 0 look-dev gate + toon/rim-light variants in the same shader before judging.
- **Old-mobile GPU precision** — projection iteration in `highp` vertex shaders; if a device misbehaves, gate falls back to paper doll exactly as today.
- **Spec sprawl** — the schema is content (`add-content` discipline applies): validated, tested, versioned like any `src/data` JSON.
- **Scope gravity** — each phase ships value alone; no phase may block on a later one.

## 6) Out of scope (entire effort)

Server/save changes; combat logic; replacing the hero GLB or its retarget pipeline; `build_single.cjs` mechanics beyond registering new chunk files; deleting the Tripo pipeline (it remains for showpieces until procedural parity is proven per-entry).
