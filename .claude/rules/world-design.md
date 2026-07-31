---
paths:
  - "world/zones/**"
  - "world/scripts/gen-*.mjs"
  - "world/client/src/editor/**"
  - "world/client/src/terrain.ts"
  - "world/client/src/terrainMaterials.ts"
  - "world/client/src/scatter.ts"
  - "world/client/src/props.ts"
  - "world/client/src/scene.ts"
  - "world/shared/zone.ts"
  - "world/shared/catalog.ts"
---

# World & Environment Design Rules

Path-scoped rule — auto-loads when authoring or rendering open-world zones. Background and rationale: `docs/world-design-review-2026-07.md`. Terrain tech: `docs/open-world-terrain-plan.md`. Editor: `docs/world-editor-guide.md`. Assets: `docs/open-world-asset-coverage.md` + build guide §2.1 (vendor steering, licensing).

## The quality gate (non-negotiable)

**No zone ships on a screenshot you haven't looked at.** Before committing a new or visually changed zone, render it (`node scripts/shoot-zone.mjs <zone>` from `world/`), read the image, and check every item below. Fix and re-shoot until all pass; note the pass in the commit/PR. "Tests green" is not visual acceptance.

Checklist:
- **Landmark**: one dominant, recognisable structure/feature visible from spawn. A zone with no landmark is not done.
- **Paths lead somewhere**: roads/trails connect spawn → landmark → exits. (Until the painted-ground layer exists, imply paths with prop lines/fences/clearings — never leave undifferentiated open field between key points.)
- **Clustered density**: props in groups with deliberate clearings between them. Uniform scatter across the whole zone is the signature of a bad generated map.
- **Dressed edges**: zone borders read as world edge (treeline, cliffs, walls, water), not as geometry ending.
- **Framed exits**: each exit visually marked (gate, arch, road narrowing) and labelled.
- **No prop errors**: nothing floating, sunk, or intersecting; solid props got the collision post-pass (see gen-varrick's footprint-blocking pattern); flood-fill reachability of every station/tree/exit/arrival holds.
- **Palette/ambience from presets**: warm and saturated, no pure grey/black ground colours, ambience consistent with the place's biome (terrain-plan §6 table; mirror `biomes3d.json` biome language). Don't invent per-zone hex values when a preset fits.

## Composition order (do it in this order)

1. **Landmark first** — place and scale the zone's centrepiece.
2. **Roads second** — the route network between spawn, landmark, exits.
3. **Buildings face roads** — orient entrances to the street; group into lots/blocks, not sprinkles.
4. **Prop clusters** — camps, groves, market rows; leave negative space.
5. **Scatter last** — flora fills gaps; scatter never carries the composition.

Scale hierarchy: landmark > buildings > trees > props > scatter. If a screenshot reads flat, the hierarchy is broken, not the asset choice.

## Process rules

- **Gen scripts produce block-outs, not final zones.** `gen-*.mjs` owns layout, collision, exits, landmark coordinates; hand-edit the script constants, never the emitted JSON. Dressing and final composition are finished via the editor or an explicit shoot→fix loop.
- **Prefer the editor** for dressing/iteration — it exists, it's deployed (`/editor`), it validates on save, and scatter/stamps/prefabs beat hand-writing prop arrays.
- **Every zone**: `terrain` block (test-enforced), exit-graph entry, examine strings for its npcs/objects, registered in `server/zones.ts` + preview map.
- **Every instanced zone** (`INSTANCED_ZONES`, `world/shared/instances.ts`) additionally: **no `deathRespawn`** — a death in one is handled by `WorldZone.ejectFromInstanceDeath` (server code, not zone config): the player is ejected out through the zone's own `exits[0]` and shown a choice screen (return to a fresh instance, or the idle game), never respawned back in front of the boss — and a `bank_chest` within 1 tile of `spawn`, so a group can restock without leaving. Both are enforced by the `describe.each` block in `world/tests/instances.test.ts`.
- **Assets**: source from `assets/open-world/` first (buildings, fountains, wells, stalls, mines, fences are already owned — check the coverage doc before declaring a gap). Rig-attached visuals from Quaternius; props/buildings/standalone NPCs from KayKit/Kenney. Commit only processed, texture-stripped GLBs, never raw pack files (paid-license terms).
- **Decoration never touches gameplay**: ground paint, roofs, scatter, ambient critters are client-render only; collision lives in the ASCII grid, interactives in `objects[]`, and the server stays flat-tile authoritative (terrain-plan §10 guardrails).
