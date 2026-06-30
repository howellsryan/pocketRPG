# Map-Driven Overhaul — Design & Migration Plan

> Status: **planning / design reference**. No engine, server, or migration changes
> have been made yet. This document is the source of truth for the overhaul so any
> session can pick it up. UX/visual reference lives in `docs/world-map-prototype/`.

## 1. Goal

Turn PocketRPG from a **menu-driven** game (every action reachable directly from the
side nav) into a **map-driven** one: a world map is the primary driver, and you reach
combat / skilling / minigames / gathering / clues / quests by **travelling to the
place they live**. Menus survive as **informational + idle** layers, not as the way
you start an action.

The mental model from the brief:
- Tap a combat monster → it no longer drops you straight into a fight. It shows
  stats / drops / location, then offers **"Travel here"**. Confirm → the map takes
  over and walks you there. On arrival the action becomes available.
- Skilling / minigames / gathering: same. Informational; if there is more than one
  location offering the action, list them and let the player pick which to travel to.
- Clues & quests become **active, multi-step** (2–4 steps) journeys across places —
  *or* you can keep idling them through today's UI. Both paths coexist.

## 2. Decisions locked (2026-06-30)

These were confirmed with the product owner and constrain the design:

| # | Decision | Choice |
|---|----------|--------|
| 1 | This session's deliverable | **Plan + design reference only.** No code/migrations yet — review before build on a live game. |
| 2 | Travel mechanic | **Time cost, resolves offline.** Travel consumes game ticks (road weights); you are "in transit" with combat locked until arrival; travel keeps progressing through idle/offline catch-up, consistent with the existing idle model. |
| 3 | Location & travel state | **In the save blob** (rides `/api/save`). No new server-authoritative endpoints for v1. |
| 4 | World content scope | **Placeholder geography.** Build the map/travel system generically now; designing the real world (place count, names, and the content→place mapping) is a separate later effort. The prototype's 8-place "Cinder Reach" is a sample, not canon. |

Implications of #3: location is **client-trusted**, exactly like the rest of the save
(§14 of `CLAUDE.md`). This is acceptable — location is not a high-value grant. It does
**not** need to live on a dedicated table, and it will **not** trip the save guards:
the total-level regression guard (`functions/_lib/game/saveValidation.js`) only inspects
`stats`, and the stale-write guard keys on `save_revision`. Do **not** add `/api/save`
validation policing location — that contradicts §14. If location ever needs to be
authoritative (e.g. it gates a server-side grant), that is the trigger to move it to a
table, not before.

## 3. What changes vs. what stays

**Stays (becomes informational / idle):**
- Existing screens (`CombatScreen`, `SkillingScreen`, `GatherScreen`,
  `MinigamesScreen`, `CluesScreen`, `QuestsScreen`, etc.) keep rendering stats, drops,
  requirements, and the idle/auto loops. They stop being the *entry point* to a fresh
  action — instead they surface a **"Travel here"** affordance.
- The idle engine, activity registry, and `activeTask` model are reused as-is. Idle
  catch-up still works the same way.
- Clues/quests can still be idled through the current UI (explicitly required).

**New:**
- A **World Map** screen (new `SCREENS.WORLD_MAP`) as the primary hub.
- A **world model** data file (places + road graph) — generic, placeholder content.
- A **travel** activity type and a small travel engine (shortest path + tick countdown).
- Save-blob fields for **current location** and **in-transit travel state**.
- A **place hub** sheet (arriving at a place shows its lore + available activity cards).

## 4. Data model

### 4.1 Save blob additions (client-trusted)
Add to the player save (seed in `src/engine/createDefaultSave.js`, default location =
the world's start place):

```jsonc
"world": {
  "location": "emberhold",          // current place id
  "travel": null                     // null when not travelling, else:
  // {
  //   "from": "emberhold",
  //   "dest": "crowfoot",
  //   "path": ["emberhold","oakhollow","crowfoot"],
  //   "totalTicks": 30,
  //   "ticksRemaining": 30,
  //   "startedAt": 1719750000000      // ms epoch, for offline resolution
  // }
}
```

Notes:
- `travel` mirrors the shape the existing `activeTask` resume path already understands
  (`totalTicks` / `ticksRemaining`, recomputed on offline return — see
  `src/App.jsx:823–860`). Travel should be modelled as a **background `activeTask` of a
  new `type: 'travel'`** so it flows through the same idle/offline catch-up machinery
  rather than a parallel system.
- `startedAt` lets offline catch-up land the player (or advance the journey) from the
  wall clock, the same way idle skilling/combat use elapsed ms.
- Migration: there is no D1 migration for this (save-blob only). The client must treat
  a missing `world` block as "at start place, not travelling" so existing live saves
  load cleanly. Add this default read in the save-load/normalisation path, not via a
  forced rewrite.

### 4.2 World model (new data file, e.g. `src/data/world.json`)
Mirror the prototype's `window.WORLD` shape (`docs/world-map-prototype/world/world-data.js`),
adapted to JSON + real content ids. Generic/placeholder for now:

- `places`: `{ id, name, tier, x, y, biome, icon, sub, lore, activities: [...] }`
- `edges`: `[fromId, toId, ticks]` — undirected road graph; travel cost between any two
  places is the **shortest path** over these weights (far places compose from legs).
- `tiers`: city / town / village / hamlet → visual size + which activity kinds appear.
- `kinds`: activity-type → tag colour + label.

Crucially, a place's `activities` entry must eventually **reference real content ids**
(monster id, skill+action id, minigame id, clue level, quest id) rather than the
prototype's free-text. Define that reference schema when world authoring begins (Phase
4). For now the data file can stay sample-only.

Keep `src/data/` immutable-content discipline (§3/§8 of `CLAUDE.md`): item/monster ids
referenced from the world model must already exist in their source data files.

## 5. Travel engine (new, pure logic in `src/engine/`)

Port the prototype's algorithm into deterministic engine code (no UI imports — §3):
- `shortestPath(from, to)` — Dijkstra over the edge weights, returns `{ path, ticks }`.
  (Prototype: `docs/world-map-prototype/world/world.js:19`.)
- Travel advances `ticksRemaining` on the App-level tick loop (600ms) like other
  background activities, and resolves elapsed ticks on offline return via the idle
  catch-up path. On `ticksRemaining → 0`: set `world.location = dest`, clear
  `world.travel`, open the destination place hub.
- "Turn back" cancels travel (clears `world.travel`; location stays at `from` — or, if
  we want partial progress, snap to the nearest passed node — **open question, see §10**).
- Combat is **locked while `world.travel` is non-null** (you can't fight in transit).
  Background skilling already in progress when travel starts: **open question (§10)** —
  simplest v1 is travel and skilling are mutually exclusive activeTasks.

## 6. Activity gating flow

The core interaction change. When a player taps an activity from an informational
screen (or from a place hub for a place they're **not** at):

1. Resolve the activity's **location(s)** from the world model.
2. If already **at** that place → start the action as today (`setActiveTask({type:'combat'|...})`).
3. If **elsewhere** → show a confirm: "Travel to {place} ({n} ticks)?"
   - More than one place offers it → list the options, let the player choose.
4. Confirm → start a `type:'travel'` activeTask to that place. On arrival, optionally
   auto-open the action or just open the place hub (**open question, §10**).

Touch points to intercept (do **not** rewrite the combat loop — just gate its entry):
- Combat start: `src/screens/CombatScreen.jsx:993,1032,1052` (`setActiveTask({type:'combat'...})`).
- Skilling / gather / minigame / agility / thieving / hunter starts: their screens'
  `setActiveTask(...)` calls.
- Clue & quest: these are already background activities; make their *steps* place-bound
  while preserving the idle alternative.

## 7. UI & integration points

- **New screen**: add `WORLD_MAP: 'world_map'` to `SCREENS` (`src/utils/constants.js:89`)
  and a `WorldMapScreen.jsx`. Wire it into the `App.jsx` screen switch and `SideNav`.
- **Single-file build (§12 of `CLAUDE.md`)**: a new in-game screen must be added to
  **both** `sourceFiles` and `GAME_CHUNK_FILES` in `build_single.cjs`. The map is an
  in-game screen (reached after `cloudPhase === 'ready'`), so it belongs in the chunk —
  unless we decide the map is the *landing* post-auth screen, in which case revisit the
  core-vs-chunk split carefully.
- **Icons**: reuse the app's existing `GameIcon` / `src/data/gameIcons.json` system
  (guarded with the `typeof gameIconsData !== 'undefined'` fallback per §12). Do **not**
  port the prototype's `assets/glyphs.js` injector.
- **Styling**: the prototype's `--fm-*` tokens are the "Forgemark" look. Reconcile with
  the app's existing `:root` tokens in `src/index.css` (Tailwind v4) — map prototype
  tokens onto existing ones or add the missing ones; don't introduce a parallel token
  system. Min tap target 44×44px; no `/N` opacity modifiers (§9).
- **Components**: pan/zoom, travel banner, and place-hub sheet should become reusable
  `src/components/` pieces, registered in `build_single.cjs` `sourceFiles` (§9).

## 8. Phased rollout (vertical slices)

Each phase is independently shippable and reversible against the live game.

- **Phase 0 — this doc + assets** (done): plan + `docs/world-map-prototype/` reference.
- **Phase 1 — read-only map** (done): `WORLD_MAP` screen rendering the graph from
  `src/data/world.json`; current location in the save blob (`worldLocation` setting,
  defaults to start place via `normaliseLocation`); pan/zoom/fit; place hub shows lore +
  activity cards **informational only** (no gating), with each place's tick-distance from
  the player shown via `shortestPath`. Gated by `WORLD_MAP_ENABLED` /
  `isWorldMapEnabled()` (`src/utils/constants.js`) — **now `true`**, so the nav tab/route
  are live for everyone (localStorage `prpg.worldmap=1` still forces it on if the const is
  flipped back). Files: `src/data/world.json`,
  `src/engine/world.js` (+ `tests/world.test.ts`), `src/screens/WorldMapScreen.jsx`,
  `.wm-*` styles in `src/index.css`; wired in `navTabs.js`, `App.jsx`, `build_single.cjs`.
- **Phase 2 — travel**: `type:'travel'` activeTask + travel engine + offline resolution
  + travel banner + "turn back". Location persists and resolves on return.
- **Phase 3 — activity gating**: intercept activity starts to require being at the
  place; "Travel here" confirms; multi-location pickers. Combat locked in transit.
- **Phase 4 — world authoring**: design the real world (places, tiers, edges) and the
  content→place reference schema; map every existing monster/skill/minigame/clue/quest
  onto places. This is the big content effort decision #4 deferred.
- **Phase 5 — active clues/quests**: multi-step place-bound clue/quest journeys, with
  the idle alternative preserved.
- **Later**: discovery/unlocks, teleport (reserved for a future magic level).

## 9. Open design questions (resolve before the relevant phase)

1. **Discovery/unlocks** vs. every place reachable immediately (the prototype's own open
   question). Affects Phase 1 data + Phase 4.
2. **Partial travel on "turn back"** — snap to nearest passed node, or revert to origin?
3. **On arrival** — auto-start the action the player came for, or just open the hub?
4. **Travel + background skilling** — mutually exclusive, or can you skill while walking?
5. **Travel cost** — pure time, or also consume supplies/food/run-energy later?
6. **Teleport** — reserved for a future magic level; out of scope for v1.
7. **Real world scale** — how many places, and the canonical map (decision #4 deferred).

## 10. Live-game safety & risks

- Save-blob only for v1 → no D1 migration, no server deploy coupling. Lowest-risk path.
- **Backward compatibility**: every existing live save lacks the `world` block. The
  load path must default it (start place, not travelling) without a forced rewrite, so
  no save is ever mutated just by loading. Verify with a logic test using a pre-overhaul
  save fixture.
- **Don't regress the idle loop**: travel reuses the `activeTask`/idle machinery; do not
  fork a second time-tracking system.
- **Don't add anti-cheat to `/api/save`** for location (§14).
- Ship behind a flag and keep the menu entry points working until Phase 3 proves out,
  so the game is never left unplayable mid-migration.
- Pass the §11 commit gate (`npm test && npm run build && npm run rebuild && npm run
  check:single`) on every code phase; add logic tests for `shortestPath`, travel
  resolution, and save-default backfill.

## 11. Reference index

- UX/visual prototype: `docs/world-map-prototype/` (`index.html`, `world/world.js`,
  `world/world-data.js`, `world/world.css`, `README.md`).
- Save baseline: `src/engine/createDefaultSave.js`.
- Activity model: `src/engine/activityRegistry.js`, `activitySession.js`,
  `activityRunner.js`; resume/offline path in `src/App.jsx:807–941`.
- Idle catch-up: `src/engine/idleEngine.js`.
- Save guards (§14): `functions/_lib/game/saveValidation.js`, `functions/api/save.js`.
- Screen routing: `src/utils/constants.js:89` (`SCREENS`), `src/App.jsx`.
- Single-file build rules: `CLAUDE.md` §12, `build_single.cjs`.
