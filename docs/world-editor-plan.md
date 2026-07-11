# World Editor — Plan (pre-build, for developer approval)

> Scope: a developer-only, browser-based editor for open-world zones — create/edit/name worlds, drag-and-drop assets (monsters, gather nodes, props, objects), portals, terrain + palette/ambience, save to the preview environment, publish to production. Pure world/environment design; no gameplay-engine changes beyond loading zone definitions dynamically.

## 1) Research findings (ground truth, verified in-repo)

- Zone format already exists and is small: `world/shared/zone.ts` (`ZoneDef`: id, name, size, spawn, ASCII collision, `objects[]` rock/tree/bank_chest, `npcs[]` with wander rects, `exits[]` portals, `props[]` visual dressing, `palette` ground colours). Validators exist: `validateZone` + `validateExitGraph`.
- Zones are **baked into the Worker at deploy** (`WorldZone.ts` imports `zones/*.json`; unknown room names are rejected). This is the one thing blocking "save and it persists" — zone definitions must become loadable from D1.
- A preview environment already exists: `wrangler deploy --env preview` → separate Worker `pocketrpg-world-preview` with its own D1 (`pocketrpg-preview`). Production is the top-level Worker on its own D1. Same code, two homes — perfect for draft → publish.
- Asset sources are already data: gather nodes from `src/data/skills.json` (mining + woodcutting actions), monsters from `src/data/monsters.json` (server combat is monster-agnostic; client falls back to a placeholder mesh for unmodelled monsters), prop GLBs in `world/client/public/models/props/`, monster model registry in `world/client/src/entities.ts` (`MONSTER_MODELS`).
- Sky/lighting is hardcoded in `scene.ts` (day sky, fixed lights). "Dark or light world" needs a small optional `ambience` zone field the client honours.
- No admin-role concept exists; the repo's established developer-only gate is a static bearer secret (Tripo bridge pattern) → `WORLD_EDITOR_TOKEN`.

**Off-the-shelf survey**: Tiled/LDtk (desktop), Sprite Fusion / PixLab (web), blurymind/tilemap-editor (embeddable JS) are all image-tileset tilemap painters. None can express our typed entities (monsters/gather nodes derived from game data), portal graphs with cross-zone validation, NPC wander rects, GLB props with rotation/scale, or the save-to-preview-D1 / publish-to-production flow — we'd write more adapter code than editor. **Decision: bespoke editor**, plain TS + DOM + canvas (the world client's stack), reusing our own validators and (later) the client's three.js zone renderer for true 3D preview.

## 2) Architecture (DECIDED pending approval)

### Storage & dynamic zones — the data-driven core
- New root migration `world_zone_defs (zone_id TEXT PK, def_json TEXT, revision INTEGER, updated_at INTEGER)` + `world_zone_revisions` (last 20 saves per zone — free undo/rollback safety net).
- `WorldZone` DO: on first connect while empty, resolve the zone def as **D1 row → else bundled `ZONES` → else reject**. Edits to an occupied zone apply next time it spins up empty (documented; an editor "kick + reload" endpoint is a later nicety). Bundled pasture/forest stay as fallback seeds; a D1 row for the same id overrides them, so existing worlds are editable too.
- Result: a saved zone is playable on preview **immediately, no deploy**.

### Editor API (on the world Worker, both envs)
`/api/world/editor/*`, every route gated by `Authorization: Bearer <WORLD_EDITOR_TOKEN>`; CORS restricted to the two world origins so the preview editor can publish to production.
- `GET /zones` — list all (bundled + stored, source + revision flags)
- `GET /zones/:id` — full def
- `PUT /zones/:id` — server-side `validateZone` + exit-graph check against all known zones, then upsert + revision bump (reject invalid — the DB never holds a broken world)
- `DELETE /zones/:id` — stored defs only
- `POST /teleport { characterId, zone, x, z }` — writes `world_positions` so you can play-test a brand-new zone that has no inbound portal yet
- Publish = the editor PUTs the same def at the **production** origin. One button, environment picker in the UI.

### Asset catalog — new content flows in with zero editor changes
`world/shared/catalog.ts` derives the library at build/run time:
- **Gather nodes**: every `skills.json` mining/woodcutting action → a placeable rock/tree (id, name, level, skill). New action in the data → new library entry.
- **Monsters**: every `monsters.json` entry (name, combat level, hp; "has 3D model" badge from the model registry, which moves to `world/shared/` so editor + client share it). Any monster is placeable — combat already works engine-side.
- **Props**: manifest auto-generated from `models/props/*.glb` via Vite glob — drop a GLB in the folder, it appears in the library.
- **Objects**: bank chest (+ future object types enumerated in this one file).
- **Palettes & ambience**: named presets (Grass, Sand, Snow, Ash, Night Forest…) + custom colour pickers; new optional `ambience: { sky, hemiIntensity, sunIntensity }` zone field with `scene.ts` support and day/dusk/night presets → "dark background or light" per zone, data-driven.

### Editor UI — `world/client/editor.html` (+ `src/editor/`, Vite multi-page)
2D top-down canvas grid (zoom/pan), library sidebar (searchable, grouped, thumbnails), inspector panel, and:
- **Terrain**: walkable/blocked brush, rectangle, flood fill; palette applied live.
- **Placement**: drag-and-drop from library onto tiles; select/move/delete; prop rotate/scale; NPC wander-rect drag handles; spawn-point tool.
- **Portals**: place exit → pick destination zone from a dropdown → click the arrival tile on a thumbnail of the target zone; two-way link helper ("create return portal").
- **Zone meta**: id, name, resize (content-preserving), palette, ambience.
- **Safety**: undo/redo, autosave draft to localStorage, dirty indicator, live validation panel (shared validators) with click-to-jump errors.
- **Flow**: New (blank or duplicate existing) · Save (preview) · Publish (production) · Play-test (teleport + open the preview world at the zone).

### Make-it-amazing extras (build after v1 is accepted, in this order)
1. **Scatter brush** — drag to sprinkle randomized props (rot/scale jitter); forests in seconds instead of 247 hand-placed entries.
2. **3D preview pane** — read-only render reusing `scene.ts`/`props.ts`/`statics.ts`, exactly what players will see.
3. **Stamps** — multi-select → copy/paste/save as reusable prefab (a camp, a grove, a mine).
4. Revision browser (restore any of the last 20 saves), collision auto-outline under props, minimap.

## 3) Plan-gate summary

**GOAL**: from a browser, a developer can create or edit a named world by dragging catalog assets onto a grid, save it, walk around it on preview immediately, and publish the identical definition to production — with the asset catalog derived entirely from existing game data so new content appears in the library automatically.

**UNKNOWNS** (each verified in its phase, before dependent work):
- DO async zone-def load ordering vs `onConnect`/first tick (Phase A e2e proves it).
- partyserver room-name routing accepts arbitrary new zone ids once the unknown-zone check consults D1 (Phase A).
- CORS + bearer auth from preview-origin editor to production Worker (Phase D; fallback is a server-side promote endpoint).
- Vite multi-page build serves `editor.html` cleanly through the Worker's ASSETS binding (Phase B, first step).

**SUCCESS CRITERIA** (agent-executable):
- `npm run world:check` green throughout; new vitest suites for catalog derivation, editor API (auth/validation/revisions/override precedence), ambience.
- E2E (wrangler dev): `PUT` a new zone via the API → WS `hello` to it → welcome carries its def → walk; `PUT` an edited forest → reconnect shows the override; invalid def → 400 with validator errors, nothing stored.
- DT-class B manual script: developer builds a small world in the editor by drag-and-drop, saves, play-tests on preview, publishes, and sees it on production.

**STEPS** — four phases, each ≤7 steps, each gated on acceptance before the next:
- **Phase A — dynamic zones (server)**: migration; D1-backed zone resolution in `WorldZone`; editor API (list/get/put/delete/teleport) + token gate; validators run server-side; e2e above. *(DT: set `WORLD_EDITOR_TOKEN` secret both envs, apply migration both D1s, deploy.)*
- **Phase B — editor shell**: `editor.html` scaffold + token prompt; canvas grid renderer (collision + palette); terrain tools; zone meta panel incl. ambience (+ `scene.ts` ambience support); load/save against the API; validation panel; localStorage draft + undo/redo.
- **Phase C — catalog & placement**: `shared/catalog.ts` + shared monster-model registry; library sidebar with drag-and-drop; object/NPC/prop/spawn tools with inspector (rotate/scale/wander-rect); portal tool with cross-zone arrival picker; duplicate-zone wizard.
- **Phase D — publish & polish**: environment switcher + publish-to-production; play-test button (teleport + open); scatter brush; palette/ambience presets; docs page (`docs/world-editor-guide.md`); bundled DT manual script.

**OUT OF SCOPE** (noticed, deliberately untouched): gameplay logic of any kind; per-tick behaviour; the unmodelled-monster client fallback currently being the cow mesh (flagged — a neutral box would look better for editor-placed exotic monsters); heightmaps/non-grid terrain; multi-user concurrent editing (single developer; last-write-wins with revision history is enough); mobile editor ergonomics (desktop tool).

## 4) Developer tasks this plan will raise
- DT-A1 (Phase A): `wrangler secret put WORLD_EDITOR_TOKEN` on both Workers; apply the new migration to preview + production D1; deploy both envs.
- DT-B (end): manual acceptance script per phase, bundled where sensible.
