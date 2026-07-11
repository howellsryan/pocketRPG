# World Editor — Developer Guide

A browser-based, developer-only editor for the open-world zones (`world/`). Create and edit named worlds, drag catalog assets onto a grid, set terrain, portals, ground palette and lighting, save to a running environment (no redeploy), play-test on preview, and publish to production. Engine logic is untouched — this designs the world and its contents only.

## Access

The editor is served by the world Worker at **`/editor`** (e.g. `https://<preview>.workers.dev/editor`). Every editor API route is gated by a static bearer secret, `WORLD_EDITOR_TOKEN`. Set it per environment:

```
cd world
npx wrangler secret put WORLD_EDITOR_TOKEN               # production Worker
npx wrangler secret put WORLD_EDITOR_TOKEN --env preview  # preview Worker
```

With the secret unset the whole editor API returns 503 (disabled, not open). Open `/editor`, enter the token once (stored in `localStorage`), and you're in.

## How it persists (data-driven, no redeploy)

Zone definitions live in the D1 table `world_zone_defs` (migration `0029`). A stored row **overrides** the bundled `world/zones/*.json` of the same id; absent, the bundled def is used. The `WorldZone` Durable Object resolves its def (stored → bundled) once when it spins up empty, so:

- **Save** writes the def to D1 and it plays **immediately** the next time that zone's DO starts empty (reconnect / fresh session). Editing a zone you're currently standing in takes effect on your next entry.
- Bundled `pasture`/`forest` remain the fallback and the seed for **Duplicate**; a stored row for the same id shadows them, so existing worlds are editable too.
- Every save keeps a bounded revision history (last 20) — see **History → Restore**.

## The asset library (derived from game data)

The library is built entirely from existing content, so new game content appears automatically:

- **Gathering nodes** — every mining/woodcutting action in `src/data/skills.json`.
- **Monsters** — every entry in `src/data/monsters.json`, sorted by combat level. A ◻ badge marks monsters with no 3D model yet (they render as a placeholder box in-game); combat still works for any monster.
- **Objects** — the bank chest (extend the list in `world/shared/catalog.ts`).
- **Scenery props** — auto-discovered from `world/client/public/models/props/*.glb`. Drop a GLB in that folder; it appears after the next build (`scripts/gen-prop-manifest.mjs`).
- **Prefabs** — your saved stamps (see Stamps).

## Tools

- **Paint grass / Paint blocked** — brush the collision grid. Rectangle and Flood fill paint grass with left-drag, blocked with right-drag.
- **Set spawn** — where players arrive with no stored position.
- **Select / move** — click a placed item to select it (edit it in the Inspector), drag to move, `Delete` to remove.
- **Portal** — click a tile to place an exit. In the Inspector pick the destination zone; the arrival picker renders that zone so you click the exact landing tile. Exits default to a valid self-target, so a zone is never left invalid.
- **Scatter prop** — arm a prop in the library, then drag to sprinkle randomized copies (rotation + scale jitter). Density slider controls how thick. Great for forests.
- **Stamp select** — drag a box over placed items to copy them as a prefab, then click to stamp copies elsewhere. **Save prefab…** stores it for reuse across zones (appears under Prefabs in the library).
- **Pan** — or hold Space / middle-drag anywhere; wheel zooms.

Placement: click a library asset then click the map, or drag it straight onto the map. `Esc` disarms. `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo. `Ctrl+S` saves. An unsaved draft is kept in `localStorage`, so a reload never loses work.

## Zone meta, palette, ambience

The right panel edits the name, size (content-preserving resize), ground palette (named presets or custom colours), and **ambience** — the sky colour and fill/sun light, i.e. the "dark or light world" control (presets: Day, Overcast, Dusk, Night, Cave Dark). Ambience flows through to the real game renderer. The **Validation** panel runs the same checks the server enforces on save.

## Preview → production

- The **Environment** selector switches which environment the editor reads and writes (Preview / Production). Production asks once for its URL and token (stored locally).
- **Save** writes to the current environment.
- **Publish →** copies the open zone straight to Production (after a confirm), so the normal flow is: build and save on preview, play-test, then publish the identical definition.
- **3D** opens a read-only preview using the actual game renderer — exactly what players see.

## Play-test a zone with no portal yet

The **Play-test** panel writes your character's world position to the open zone's spawn (`character id` field). Save the zone first, click **Teleport me here**, then enter the world normally — you'll spawn in the new zone even if nothing links to it yet.

## Files

- Server: `world/server/editor.ts` (API), `world/server/zoneStore.ts` (D1), `world/server/zones.ts` (bundled registry), `world/server/WorldZone.ts` (dynamic resolution). Migration `migrations/0029_world_zone_defs.sql`.
- Client: `world/client/editor.html` + `world/client/src/editor/*` (`main.ts`, `state.ts`, `grid.ts`, `placement.ts`, `stamps.ts`, `picker.ts`, `preview3d.ts`, `presets.ts`, `api.ts`). Catalog: `world/shared/catalog.ts` + `world/shared/monsterModels.ts`.
- Tests: `world/tests/editor.test.ts`, `catalog.test.ts`, `stamps.test.ts`, ambience cases in `zone.test.ts`.

## Deploy checklist (DT)

1. Apply the migration to both D1s: `npx wrangler d1 migrations apply pocketrpg-preview --env preview --remote` and `npx wrangler d1 migrations apply pocketrpg --remote` (from `world/` for the preview binding; production per the usual repo flow).
2. `npx wrangler secret put WORLD_EDITOR_TOKEN` on both the preview and production Workers (any strong random string).
3. Deploy both: `npx wrangler deploy --env preview` and `npx wrangler deploy`.
4. Open `<preview>/editor`, unlock, build a small world, save, **Teleport me here**, enter the world and confirm it plays; then **Publish →** and confirm it appears on production.
