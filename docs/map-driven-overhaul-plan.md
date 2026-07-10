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
- **Phase 2 — travel** (done): `type:'travel'` background activeTask + travel engine
  (`src/engine/travel.js`: `createTravelTask`/`advanceTravel`/`travelFraction`, +
  `pathLegs` in `world.js`; `tests/travel.test.ts`). Costs road ticks; counts down on
  the live App tick (`App.jsx`), and resolves offline via `advanceTravel` on tab-return
  (`App.jsx` visibility handler) and cold boot (`gameState.loadGame`). Arrival updates
  `worldLocation` + clears the task + toasts. World Map shows a travel banner (progress
  + route + **Turn back**), an animated traveller token, and a **Travel here** action in
  the place hub. Registered `travel` as background in `activityRegistry.js` (no ledger
  key). Combat-lock-in-transit is deferred to Phase 3 (activity gating).
- **Phase 3 — activity gating** (done): fresh activity starts are intercepted by
  `requestActivityStart` (`src/state/gameState.jsx`) — must be at a place that offers the
  activity, else a `TravelPrompt` (`src/components/TravelPrompt.jsx`) confirms travel
  (single place) or shows a multi-location picker; starting is blocked while in transit
  (combat lock). On arrival, a gated activity start now resumes automatically (see the
  post-Phase-4 polish bullet); manual map travel still just lands at the destination. Gating
  engine: `src/engine/worldContent.js` (`activityRef`/`placesForActivity`/
  `resolveActivityStart`/`describeActivity`, + `tests/worldContent.test.ts`). Gated at the
  §6 touch points in Combat/Skilling/Gather/Agility/Thieving/Hunter/Construction screens.
  Gated by `isWorldMapEnabled()` (flag off → menu-driven fallback). Travel/skilling are
  mutually exclusive (single `activeTask`).
  - **Phase 4 content pulled forward**: decision #4 was taken early — *all* startable
    content (monsters, gated skill actions, gather/agility/thieving/hunter, construction)
    is mapped onto the world geography by a deterministic auto-distributor,
    `scripts/seedWorldContent.cjs`, whose output is committed into `src/data/world.json`
    (`activities` are now `{ kind, ref }`). Re-run the script after adding content.
    Quests/clues stay ungated (Phase 5). Slayer/dungeoneering are intentionally unmapped
    (fall through to start normally).
  - **Facilities**: some skills are tied to a building rather than level-banded. Places
    carry an authored `facilities` array and the world has a `facilities` metadata map.
    **Bank** offers construction, magic, thieving, prayer, firemaking, herblore, fletching,
    crafting, cooking; **Furnace & Anvil** offers smithing. Every action of a facility
    skill is available at every place with that facility (`FACILITY_SKILLS` in the seed,
    which reads `place.facilities`). Magic trains via its own screen, so `MagicScreen` is
    also gated; the place hub shows facility chips. Remaining `skill`-kind training
    (mining/woodcutting/fishing/runecraft), combat, agility, hunter and gather tasks stay
    level-banded — the seed orders places low→high (start place anchored first) so the
    starter has the lowest-level monsters and cities hold the bosses.
- **Phase 4 — world authoring** (done): real geography authored — the OSRS-inspired realm
  of **Eldermoor**, 14 places (Lumbright starter; cities Varrick/Faloden/Ardounne; towns
  Edgevale/Al-Karid/Seerhold/Brimhollow/Camlann/Port Sarin; villages Draynar/Barlock/
  Catherra/Canifel), all reachable from the start. Geography + facilities are hand-authored
  in `src/data/world.json`; `seedWorldContent.cjs` fills `activities` and reads facilities
  rather than deriving them. Discovery/unlocks remain a later effort (§9.1).
- **Post-Phase-4 polish** (done): map presentation + content-fidelity pass.
  - **Bespoke art** (`src/components/PlaceArt.jsx`): `PlaceIcon` draws the settlement-tier
    medallions (city/town/village/hamlet) and the furnace-&-anvil facility glyph, pure SVG;
    **bank reuses the existing in-game bank icon** (the nav `coins` glyph via `GameIcon`).
    `PlaceScene` is a wide, per-place establishing illustration on the hub banner. If a
    place has a generated `image` (static asset under `/public/world/`, e.g. `draynar`,
    `seerhold`), that photo is shown directly; otherwise it falls back to a hand-drawn
    vector scene (e.g. Faloden = white castle + white bridge, Al-Karid = desert palace,
    Brimhollow = volcano + docks), composed from landmark primitives and keyed by place id
    with a tier-themed fallback. Responsive (viewBox + `xMidYMid slice`, or `object-fit:
    cover` for photos). Styling: `.wm-hub-scene`, `.wm-face-art` in `src/index.css`.
  - **Raids are their own kind** (`kind: 'raid'`), authored at a city in the seed and gated
    on the raid (not its first boss). Raid boss monsters are excluded from the `combat`
    distribution so they no longer appear as standalone map monsters. `startRaid` requests
    `{ type: 'raid', raid }`; `worldContent.js` adds `raid` to `activityRef`/`describeActivity`.
  - **Agility/thieving renamed to the world geography**: rooftop courses are named after and
    placed at their namesake world city (Ardounne/Faloden/Varrick/…), OSRS levels preserved;
    `Pickpocket Silverkeep Knight` → `Pickpocket Ardounne Knight`. Placement is authored in
    the seed (`AGILITY_PLACEMENT`), not level-banded.
  - **Painted terrain** (`WorldTerrain` in `src/components/PlaceArt.jsx`): the board
    behind the graph is a full painted chart — the Sarin Sea + coastline, Loch Camlann,
    rivers (bridging Faloden/Lumbright per their scenes), the Kharid Sands, the Draynar
    Mistmarsh, Duskwood, the Eldern Peaks, forests/grass/fields, compass rose, ship and
    region labels. Deterministic fixed-seed scatter with exclusion zones around nodes,
    roads and tick labels. Styling: `.wm-terrain`/`.wm-grunge` (aged-vellum multiply
    overlay) in `src/index.css`; node name plates flipped from dark iron to vellum tags.
  - **Arrival auto-start**: a gated start embeds an `autoStart` descriptor
    (`autoStartFromTask`) in the travel task; on arrival `App.jsx` `resumeAutoStart` navigates
    to the owning screen so combat/skilling begins immediately, even while idling. Rides the
    persisted task (survives tab-return). Supersedes the earlier "no auto-start" decision for
    the gated-start flow only.
- **Phase 5 — active clues/quests** (done): multi-step place-bound journeys.
  Engine: `src/engine/journeys.js` (+ `tests/journeys.test.ts`).
  A journey is a chain of ordinary `type:'travel'` tasks carrying a `journey`
  descriptor: travel to waypoint → *search* it (a zero-distance travel dwell) → … →
  the final search completes the content through the same path idling used
  (`completeClueSolve` / `handleQuestCompletion` in `App.jsx` — server-authoritative
  clue rewards included). 2–4 waypoints scale with idle duration; waypoints are
  deterministic per (content, origin) and drawn from increasing distance bands; total
  search time ≈ `JOURNEY_TIME_FACTOR` (1 — the content's full advertised duration;
  teleports save road time only) × the idle duration, plus real road time.
  Offline: `advanceJourneyOffline` chains phases through elapsed time but never grants —
  a journey that finished away is parked on its final search at 0 ticks and the App's
  first live tick completes it.
- **Phase 5b — journeys ARE the flow** (done): the stationary clue/quest timers are
  retired; `planClueJourney`/`planQuestJourney` are the only start paths (legacy saved
  timer tasks still tick out in `App.jsx`). Starting from `CluesScreen`/`QuestsScreen`
  drops the player onto the World Map. Background auto-chaining keeps the idle loop:
  finishing a clue trail with another scroll of that tier starts the next trail from
  where it ended, and quest completion promotes the quest queue as journeys
  (`promoteNextQueuedQuestOrClear`). The banner shows step/phase with "Abandon journey"
  (scroll/quest only consumed on the final search).
- **Teleports** (done, was "reserved"): every place carries `teleport: {level, xp, runes}`
  in `world.json` — cities cheap/low (Varrick 25: 1 law/3 air/1 fire), towns 45–64,
  villages 70–87 with nature/blood/soul runes. `src/engine/teleports.js`
  (+ `tests/teleports.test.ts`): rune check/deduction is inventory-first-then-bank with
  elemental-staff exemption (shared `getRunesToConsume`), casting is instant, grants
  Magic XP (level+10), and supersedes the task slot like starting a walk. Cast from the
  place hub or the travel banner's "Teleport ahead"; mid-journey it re-plans the walking
  leg from the landing place (`teleportIntoJourney`) — landing on the waypoint skips
  straight to the search. A search in progress is bound to its waypoint (finish or abandon).
- **Map art (in progress)**: the board supports a generated background image —
  `world.json` top-level `mapImage` (e.g. `/public/world/map.webp`) replaces the
  painted procedural terrain when present/loadable, with automatic fallback.
  Generation: `TRIPO_API_KEY=… node scripts/tripo-worldmap.mjs` drives Tripo's
  task API (text→model; the task's `rendered_image` output is the map art) with a
  prompt describing a like-for-like OSRS-style overworld. Once the art is picked:
  commit it as `public/world/map.webp`, set `mapImage`, and re-place each place's
  x/y onto its analogue region. Regions on the art with no PocketRPG place yet are
  deliberate future scope — they stay visible but uninhabited until places are
  added (data-only change). The API key is env-only, never committed.
- **Later**: discovery/unlocks.

## 9. Open design questions (resolve before the relevant phase)

1. **Discovery/unlocks** vs. every place reachable immediately. **Phase 4 decision: all
   reachable from the start** for now; progressive unlocks remain a later effort.
2. **Partial travel on "turn back"** — ~~snap to nearest passed node, or revert to
   origin?~~ **Resolved: snap to the last node fully reached** (completed legs keep
   their progress; a partial leg walks back — never forward). `travelCancelLocation`
   in `src/engine/travel.js`.
3. **On arrival** — ~~auto-start the action the player came for, or just open the hub?~~
   **Resolved (Phase 3): just open the hub.**
4. **Travel + background skilling** — ~~mutually exclusive, or can you skill while
   walking?~~ **Resolved (Phase 3): mutually exclusive (single activeTask).**
5. **Travel cost** — pure time, or also consume supplies/food/run-energy later?
6. **Teleport** — ~~reserved for a future magic level; out of scope for v1.~~
   **Resolved: shipped as per-place Magic teleports** (see Teleports above).
7. **Real world scale** — ~~how many places, and the canonical map.~~ **Resolved
   (Phase 4): 14 places, the realm of Eldermoor (OSRS-inspired). Expandable later.**

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
