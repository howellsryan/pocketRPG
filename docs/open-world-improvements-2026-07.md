# Open-World Improvements — Decision Record (2026-07)

> All 12 items below are Done. Item 12 keeps one explicitly-scoped cut (stage 3,
> armour coverage beyond body/legs, dropped per the plan's own "only start it if
> 1–2 land cleanly" staging). Items 1 and 2 were previously partial (asset
> rebuild blocked on the missing 71 MiB source GLB); the source was re-supplied
> and both GLBs are now rebuilt — see the 2026-07-20 follow-up notes in their
> Outcome sections. This file is the record of what shipped and why.

## Ground rules (read before starting)

- **Verify commands** (run before every commit that touches `world/`):
  - `cd world && npm run ci` — typecheck + vitest + client build (or `npm run world:check` from repo root).
  - Repo-root `npm run ci` as well if the change touches anything under `src/` or `scripts/` (shared data/build scripts).
- **Local dev loop**: `cd world && npm run dev` (DO server) + `npm run dev:client`
  (Vite client), `npm run dev:seed` to seed a character. Grondar spawns: overworld
  `wild_grondar` (`world/zones/overworld.json`) and `grondar_1` in the Varrick
  dungeon (`world/scripts/gen-varrick-dungeon.mjs:98`).
- **Protocol changes** (items 10, 11): `world/shared/protocol.ts` is the single
  source of truth; every new `ClientMessage` must be added to `parseClientMessage`
  (unknown/malformed ⇒ `null` ⇒ connection close) and covered in
  `world/tests/protocol.test.ts`.
- **Model/asset changes** (items 1, 2, 12): rebuilt GLBs under
  `world/client/public/models/` and `public/3d-samples/` are committed artifacts —
  rebuild via the named script and commit the output. Source packs live in
  `assets/open-world/` (the ~71 MiB Grondar source GLB is gitignored; it must be
  present locally at `assets/open-world/Warlord+Grondar.glb` to re-run its build).
- **Tests**: every logic change gets a test in `world/tests/`. UI-DOM heavy code
  (ui.ts panels) is tested where a pure helper can be extracted (see
  `world-hud.test.ts`, `minimap-view.test.ts`, `bank.test.ts` for the pattern:
  extract pure functions, test those).
- **No PR without the `pr-changelog` skill** — PR title/body publish verbatim to the
  players' Discord changelog. Player-facing voice, no internal notes.

## Status board

| # | Item | Status |
|---|------|--------|
| 1 | Grondar idle/walk animations broken | Done |
| 2 | Lag near Grondar | Done |
| 3 | Inventory panel: no scrollbars, full 28 slots, aligned tabs | Done |
| 4 | F1–F5 tab shortcuts | Done |
| 5 | Escape closes open modal | Done |
| 6 | Minimap icons (banks, skilling, monsters) | Done |
| 7 | PocketRPG-styled scrollbars | Done |
| 8 | Bank modal at ~75% screen, responsive | Done |
| 9 | Shared/deterministic ambient NPCs | Done |
| 10 | Follow another player (right-click) | Done |
| 11 | Show player hitpoints in combat | Done |
| 12 | Open-world hero = combat-arena hero | Done (stages 1–2; stage 3 dropped) |

**Suggested order**: 3 → 5 → 4 → 7 → 8 → 6 (small, independent UI wins; 7 before 8
so the bank redesign uses the new scrollbars) · then 1 → 2 (same asset/code area,
diagnose together) · 11 → 10 (10 builds on the "players are pickable" change and
both touch tick/protocol) · 9 · 12 (largest, asset-pipeline work).

---

## Item 1 — Warlord Grondar plays no/wrong idle & walk animations

**Status**: Done

**2026-07-20 follow-up (asset rebuild now shipped)**: the 71 MiB source was
re-supplied, so `scripts/build-warlord-grondar.mjs` was run and both GLBs
committed. Verified: the idle clip's samplers went from 83 STEP / 40 LINEAR to
**123 LINEAR** on *both* surfaces (arena `Idle`, world `idle`) — the STEP→LINEAR
fix that had only ever existed in the script now lives in the runtime assets, so
Grondar's 15.4 s idle plays as continuous motion instead of a stepped freeze.
attack/die keep their authored 82 STEP / 41 LINEAR (unchanged, both surfaces).
The world and arena now play byte-identical animation data. (The build was also
split per-surface for item 2 — see there.) The prior partial Outcome below is
retained for history.
**Outcome**: Two changes landed. (1) `scripts/build-warlord-grondar.mjs`: corrected
the root-cause mechanism — `resample()` (from `@gltf-transform/functions`) only
dedupes keyframes *within* a sampler's existing interpolation mode; it never
converts LINEAR to STEP (confirmed by reading its source), so the plan's
"artifact of resample()" framing was imprecise. The actual STEP interpolation
is authored into the source GLB. Fixed by explicitly forcing any STEP sampler
in the `NlaTrack` (idle) animation to LINEAR after the decimation pass, leaving
attack/death untouched in case their STEP keys are an intentional snappy pose
change. **Could not rebuild/commit the GLBs** — `assets/open-world/Warlord+Grondar.glb`
(gitignored, ~71 MiB) isn't present in this environment; the script fix is
ready but needs a maintainer with the source asset to run
`node scripts/build-warlord-grondar.mjs` and commit the two output GLBs.
(2) Procedural gait (`world/client/src/motion.ts` `gaitBob`, wired via
`monsterModels.ts`'s new `noLocomotionClip` flag and `entities.ts`'s
`GltfAnimator.gait`): while a flagged boss is moving, a small vertical bob +
side-to-side rock is layered onto the model on top of the aliased idle clip,
so wandering no longer reads as a frozen statue sliding. Unit-tested
(`tests/motion.test.ts`). Live-verified in the dev client that the world loads
and Grondar (`wild_grondar`, overworld ~(280,42)) is reachable and renders as
the real model (not a placeholder box) — a full before/after animation
comparison against the current STEP-heavy asset wasn't attempted live since he
one-shots a fresh level-20 dev character at melee range; static/asset-level
verification only.

### Symptom
Grondar renders but appears frozen: no idle animation, and he glides when wandering.

### What is already verified (don't re-derive)
Static inspection of the committed `world/client/public/models/warlord_grondar.glb`
(2.8 MiB) confirms the asset is structurally sound:
- Clips `idle` / `attack` / `die` all present (123 channels each, 41 bone targets,
  15.4 s idle). **No `walk` clip exists** — `makeAnimator` deliberately aliases
  walk → idle for bosses (`world/client/src/entities.ts:122-126`), so gliding while
  wandering is the *designed* current behaviour, not a regression.
- Skinning survived decimation (`JOINTS_0`/`WEIGHTS_0` present; 1 skinned node,
  41-joint skin; all node names unique — so `SkeletonUtils.clone` + mixer
  property-binding should resolve).
- Extensions are only `EXT_texture_webp` + `KHR_mesh_quantization` (both natively
  supported by GLTFLoader; **no** meshopt compression despite the build-script
  comment claiming it — flag the stale comment, don't fix the script for this).
- Of the idle clip's 123 samplers, **83 are STEP-interpolated** and only 40 LINEAR
  (an artifact of `resample()` in `scripts/build-warlord-grondar.mjs`). A mostly-STEP
  idle can read as "frozen with occasional pops" — this is the leading asset-side
  suspect for "no idle animation".

### Diagnosis steps (do first, in order)
1. Run the dev client, stand near Grondar (dungeon spawn is easiest), open the
   browser console/network tab:
   - If Grondar renders as a **brown box**, the GLB failed to load (`createMonsterMesh`
     catch → `boxPlaceholder`, `entities.ts:199-201`) — check the network tab for the
     404/error and fix the asset path/deploy.
   - If he renders as the real model, temporarily log inside `makeAnimator`
     (`entities.ts:109`) whether the idle action was found and is playing.
2. Compare against the combat arena: the arena consumes the same decimated
   intermediate (`public/3d-samples/monsters/warlord_grondar.glb` with `Idle` clip)
   via `CombatArena3D`. If the arena's Grondar idles visibly and the world's does
   not, the bug is world-client wiring; if **both** look frozen, it's the asset
   (STEP interpolation), and the fix is in the build script.
3. Useful tools: `world/scripts/list-anims.mjs`, `world/scripts/inspect-glb.mjs`.

### Fix plan
- **Asset fix (likely)**: in `scripts/build-warlord-grondar.mjs`, stop `resample()`
  collapsing tracks to STEP (drop resample for this model or configure its
  tolerance), rebuild both outputs, and confirm the idle clip's samplers come out
  LINEAR with dense keys. Requires the gitignored source GLB — if it isn't present
  locally, say so in the Outcome and hand the rebuild step back to the maintainer
  rather than skipping the item silently.
- **Walk animation**: the rig is bespoke (Tripo/CC-style bone names `L_Foot`,
  `L_Thigh`…), so UAL clips can't be merged by name like the hero's. Do **not**
  attempt a full retarget. Instead give moving bosses a cheap procedural gait in
  the client: while `entity.moving` and the current GLTF action is the aliased
  idle, apply a subtle rhythmic body sway/bob to the mesh group (same spirit as
  `ambient.ts`'s bob). Keep it behind a per-model flag in
  `world/shared/monsterModels.ts` (e.g. "has no locomotion clip") so normal
  monsters with real walk clips are untouched.
- Keep `attack`/`die` behaviour as-is unless diagnosis shows them broken too.

### Tests & verification
- Unit: extend `world/tests/` motion/entities coverage where a pure helper is
  extracted (e.g. the bob function: input time/moving → offset).
- Manual: Grondar visibly breathes/sways at idle; wandering no longer reads as a
  frozen statue sliding; attack + death still play. Check both dungeon and
  overworld spawns.

---

## Item 2 — Severe lag near Grondar

**Status**: Done

**2026-07-20 follow-up (model-weight fix now shipped)**: with the source
re-supplied, `scripts/build-warlord-grondar.mjs` now decimates per-surface from
a shared animation-fixed base instead of one common intermediate — the arena
keeps its close-up quality (~94k tris, 1024px textures) while the open-world GLB
drops to **~39k tris / 512px textures (2.67 → 1.41 MiB)**, since the world draws
Grondar as a skinned, shadow-casting, frustum-cull-disabled entity amongst many
others (hypothesis 1). Bounds are unchanged (spec in `monsterModels.ts` needs no
edit). Fix 3 (AoI mesh-reuse cache) remains unattempted — still "only if the
profile confirms it", and no repeatable in-browser profile was captured this
session. The prior partial Outcome below is retained for history.
**Outcome**: Applied fix 2 (DOM thrash) unconditionally, per the plan — it's
correct regardless of profiling. `world/client/src/main.ts`: `showBossFrame`/
`setThreatPanel` (the latter clears + rebuilds rows via `innerHTML` every
animation frame) now only run when the drawn hp/maxHp/npcId or the
`threatByNpc` contributors array reference actually changed since the last
frame — cached in `lastBossFrame`/`lastThreatContributors`, gated with cheap
identity/equality checks. `hideBossFrame` is likewise only called on the
transition into "no boss target" rather than every frame while not fighting a
boss. Fixes 1 (rebuild Grondar at a lower triangle count) and 3 (AoI churn
mesh-reuse cache) were **not attempted**: fix 1 needs the same missing source
GLB as item 1; fix 3 is explicitly "only if the profile confirms it" and I
couldn't safely/repeatedly stand near Grondar in a browser profiler within
this session (see item 1's outcome) to gather that evidence. No before/after
FPS numbers recorded — flagging for the maintainer to profile fixes 1 and 3
against the real client.

### Symptom
Frame rate drops sharply whenever the player is near Grondar.

### Ranked hypotheses (verify with the browser performance profiler before fixing)
1. **Model weight.** Grondar is ~94 k triangles — 10–40× every other world model
   (goblin ~156 KiB GLB, hero 2 MiB but far fewer tris) — skinned, with
   `castShadow` forced on every sub-mesh and frustum culling disabled
   (`entities.ts:78-83`), so he's skinned + drawn twice (shadow pass + main pass)
   every frame even partially off-screen. On integrated GPUs this alone can halve
   the frame rate. **Fix**: rebuild at a lower `SIMPLIFY_RATIO` (0.05 → ~0.02,
   target ≤ 40 k tris — the boss silhouette survives) and drop texture resize to
   512 px in `scripts/build-warlord-grondar.mjs`; same source-GLB caveat as item 1.
2. **Per-frame DOM rebuild while targeting a boss.** `main.ts:654-663` calls
   `showBossFrame` + `setThreatPanel` **every animation frame**; `setThreatPanel`
   (`ui.ts:1140-1152`) clears and rebuilds its rows with innerHTML each call —
   layout thrash at 60 fps. **Fix**: only touch the DOM when the values actually
   changed (cache last hp/contributor snapshot; the threat snapshot object in
   `threatByNpc` only changes when a `{e:'threat'}` event lands, so identity
   comparison is enough).
3. **Entity churn at the AoI boundary.** If Grondar's wander rectangle straddles
   the player's AoI radius (`WorldZone.ts:1437-1463`), the client repeatedly
   destroys and recreates his entity (`removeNpc`/`ensureNpc`, `main.ts:235-270`),
   and every recreation re-clones the 94 k-tri skinned mesh. **Fix if observed**:
   keep a small client-side cache of recently-removed boss meshes keyed by
   monsterId and reuse instead of re-cloning (template GLTF is already cached —
   the clone is the expensive part).

### Verification
Record before/after FPS (browser FPS meter or profiler) in the same spot near the
dungeon spawn. All three fixes are independent; apply 2 unconditionally (it's
correct regardless), 1 and 3 as the profile confirms them. Note findings in the
Outcome line.

---

## Item 3 — Inventory panel: full 28 slots, no scrollbars, tabs aligned

**Status**: Done
**Outcome**: Removed `INV_VISIBLE_ROWS`/the `max-height`+`overflow-y` cap on
`#inv-panel` — all 7×4 slots always render, matching the tab rails (which
were already sized off the panel's own content width, so no separate
alignment fix was needed). Added a `@media (max-height: 640px)` rule pulling
`#hud-panel`'s top anchor from 200px to 148px on short viewports (still clear
of the minimap, which ends at 140px) so the taller 7-row body doesn't push the
bottom tab rail off-screen. Visually verified end-to-end in the dev client
(Playwright, 390×844): all 28 slots visible, no scrollbar, tab rails flush
with the panel edges.

### Root cause (confirmed)
`world/client/src/ui.ts:24-28`: `INV_VISIBLE_ROWS = 4` caps `#inv-panel` at 4 of 7
rows with `max-height` + `overflow-y: auto` (`ui.ts:64-68`). This was a deliberate
earlier change ("show 4 rows before scrolling") that the user now reverses.

### Fix plan
- Remove the visible-rows cap: `#inv-panel` always shows the full 7×4 grid
  (`INVENTORY_COLS`/`INVENTORY_ROWS`), no `max-height`, no `overflow-y`.
- Panel width: `HUD_PANEL_WIDTH` (`ui.ts:34`) already sizes the panel off the grid
  content width clamped to the tab rail's 44 px tap-target floor — keep that, and
  confirm the top tab rail (4 tabs) and bottom rail (equipment/map/logout,
  `ui.ts:44-47`) both span exactly the panel width so tabs align flush with the
  inventory's edges on desktop and mobile.
- Sanity-check the vertical fit on a short mobile viewport (e.g. 667 px tall):
  the HUD is `position: fixed; top: 200px` (`ui.ts:40`) — with 7 rows the body may
  overflow the viewport bottom. If it does, adjust the panel's top anchor or make
  *only non-inventory* panes cap their height; the inventory itself must never
  scroll. Note what you chose in the Outcome.

### Tests & verification
- `world/tests/world-hud.test.ts` covers HUD constants/derivations — extend for the
  new sizing rule (e.g. panel height derivation, or at minimum the removed cap).
- Manual: desktop + narrow window: all 28 slots visible, no scrollbar, tab rails
  flush with panel edges; drag-reorder still works across all 7 rows.

---

## Item 4 — F1–F5 switch HUD tabs

**Status**: Done
**Outcome**: Built as planned: one global `keydown` listener installed by
`initHud`, a pure `keyToHudTab` mapping (F1–F5 → inventory/equipment/prayer/
magic/combat, tested), `preventDefault` on the five F-keys, routed through the
existing `selectTab`, and an `isEditableTarget` guard (belt-and-braces —
chat/bank inputs already `stopPropagation()` on every keydown so they never
reach this listener). Visually verified in the dev client: F2/F3 switch tabs,
F5 does not reload the page.

### Mapping (per request)
F1 → inventory · F2 → equipment · F3 → prayer · F4 → magic · F5 → combat
(attack styles + special attack live on the combat pane).

### Fix plan
- Add one global `keydown` listener in `ui.ts` (installed by `initHud`):
  - `event.preventDefault()` on the five F-keys — this is the point of the item
    (F5 currently refreshes the page, F1 opens browser help).
  - Route to the existing `selectTab(id)` (`ui.ts:417`) — it already handles the
    bottom-rail equipment tab because it queries `.hud-tab[data-tab]` globally,
    and un-collapses the body.
  - Ignore the shortcut when focus is in an input/textarea (`document.activeElement`)
    — the chat input and bank search already `stopPropagation()` on their own
    keydowns (`ui.ts:966-973`, `bank.ts:273-284`), but belt-and-braces the guard
    anyway for future inputs.
- Do not bind F6+ or plain letters; camera arrows stay in `cameraControls.ts`.

### Tests & verification
- Extract the key→tab mapping as a pure exported helper; test it in
  `world-hud.test.ts` (including "returns null while an input is focused" logic if
  expressed purely).
- Manual: each F-key switches tabs and never triggers the browser default (F5 must
  not reload); typing in chat with F-keys does nothing to tabs.

---

## Item 5 — Escape closes the open modal

**Status**: Done
**Outcome**: Built as a registry rather than hardcoded priority chain, since
ui.ts can't import bank.ts/crafting.ts/worldMap.ts without a circular
dependency (they already import ui.ts): `registerEscapeHandler(priority, fn)`
+ a pure `runEscapeHandlers` core (tested) that runs handlers lowest-priority-
first, stopping at the first that reports it closed something. Priority 1 =
bank qty prompt (fallback for when it's open but unfocused — normally its own
input's Escape handler fires first via `stopPropagation`), 2 = context menu
(ui.ts, owns `hideContextMenu` already), 3 = bank/craft/world-map modals
(mutually exclusive in practice, so relative order among them doesn't
matter). Visually verified in the dev client: right-click → context menu →
Escape closes it cleanly.

### Current state
No global Escape handling. Escape inside the chat input blurs it (`ui.ts:968`);
inside the bank search clears it (`bank.ts:273-280`); inside the qty prompt closes
just that box (`bank.ts:130-134`). The bank/crafting/world-map modals and the
context menu ignore Escape entirely.

### Fix plan
- One global `keydown` (share the listener from item 4) handling Escape by
  priority — close only the **topmost** thing, one per press:
  1. bank qty prompt (`#bank-qty-prompt`)
  2. context menu (`hideContextMenu`, `ui.ts:1014`)
  3. bank modal (`closeBankUI`), crafting modal (`closeCraftUI`), world-map
     overlay (check `worldMap.ts` for its close function) — whichever is open
     (they're mutually exclusive in practice).
- Because the focused chat input and bank search `stopPropagation()`, their
  existing per-input Escape behaviour is naturally preserved (first Escape blurs/
  clears, second Escape reaches the global handler and closes the modal). Keep it
  that way.

### Tests & verification
- If the priority routing is expressed as a pure helper (list of open-modal flags →
  action), test it; otherwise cover via the existing bank test seams.
- Manual: Escape closes bank, crafting, world map, context menu, qty prompt — one
  layer per press; Escape with nothing open does nothing.

---

## Item 6 — Minimap shows world icons (banks, skilling, monsters)

**Status**: Done
**Outcome**: Lifted `STATIC_CATEGORY`/`CATEGORY_ICON_KEY` out of `worldMap.ts`
into new `world/shared/mapCategories.ts` (tested structurally: every category
has an icon key). `minimap.ts` clusters the zone's statics once at load
(`clusterStatics`, small radius) and rasterises each needed bespoke icon once
via an offscreen `Image` (SVG → data URL → `drawImage`), drawn under the live
dots each `update()` — gated by a new pure `inMinimapView` helper (tested).
Kept `SIZE_PX` at 132 rather than bumping it: icons render small (11px) but
legible; bumping to ~160 would have pushed the minimap's bottom edge past the
148px HUD top-anchor introduced for short viewports in item 3, and I didn't
want to re-tune both together without visual confirmation on a real short
device. Boss NPCs get a distinct colour + slightly larger dot (`MinimapDot`
gained an optional `boss` flag, sourced from `monsters.json`'s `boss` flag in
`main.ts`) — live NPC dots otherwise unchanged (position matters more than
species at this size). Visually verified in the dev client: category icons
render near the starting town's bank/furnace and reposition correctly as the
view window pans; a boss NPC's minimap dot renders in the distinct colour.

### Current state
`world/client/src/minimap.ts` draws only coloured dots: self, npcs (red), other
players (white), exits (cyan). The **big world map** (`worldMap.ts:357-395`) already
solves categorisation + icons: statics → category via its `CATEGORY_OF` map
(bank_chest → bank, rock → mining, tree → woodcutting, furnace/anvil → smithing,
range → cooking), clustered with `clusterByType` (`world/shared/mapClusters.ts`),
icon per category via `CATEGORY_ICON_KEY` + `uiIconMarkup`.

### Fix plan
- Reuse, don't duplicate: lift the statics→category and category→icon-key tables
  out of `worldMap.ts` into a small shared module both maps import.
- In `createMinimap`, accept the zone statics (already available in `main.ts` at
  minimap creation time — `message.statics`), cluster them once with
  `clusterByType` at a small radius (statics never move), and rasterise each
  needed category icon once (SVG markup → `Image`/`ImageBitmap` → offscreen
  canvas) at ~10–12 px.
- Each `update()` draws the cluster icons that fall inside the current view
  window (same `minimapView` transform as the dots), **under** the live dots.
- Monsters: live NPC positions already render as red dots each update. Keep the
  live dots (positions matter more than species at 132 px) but colour/mark boss
  NPCs distinctly if trivially possible. If icon legibility at 132 px is poor,
  bumping `SIZE_PX` modestly (e.g. 132 → 160) is acceptable — note it in the
  Outcome and keep it clear of the HUD panel below (`#minimap` is `top: 8px`,
  HUD starts at 200 px).

### Tests & verification
- `mapClusters.test.ts` and `minimap-view.test.ts` exist — add coverage for the
  shared category tables and any new pure windowing/placement helper.
- Manual: near Lumbright bank + mine: bank icon, mining icon, tree icon appear on
  the minimap in the right spots, pan correctly with the view window, and don't
  obscure the player dot. Zone without statics (dungeon) renders as before.

---

## Item 7 — PocketRPG-styled scrollbars for legitimate scroll areas

**Status**: Done
**Outcome**: One shared `.pr-scroll` class (WebKit `::-webkit-scrollbar` +
Firefox `scrollbar-width`/`scrollbar-color`, brass/gold thumb on a dark
track per `DESIGN.md`'s brass palette — the world client doesn't load the
main app's `src/index.css` tokens, so the hex values are hard-coded here as
the plan anticipated) defined once in `ui.ts` (`SCROLL_CLASS`/`SCROLL_CSS`,
folded into `HUD_CSS` since `initHud()` always runs before any modal is
reachable) and applied to the bank grids, the crafting recipe list, the
prayer grid, and the magic panel. Verified with a scratch harness (imported
`bank.ts`'s `openBankUI` directly, after `initHud()`, into a throwaway Vite
page — never committed) that the class carries `scrollbar-width: thin` and
the brass `scrollbar-color` once the real HUD boot order is followed.

### Scope
The scroll areas that remain *after* item 3 removes the inventory scroll: bank
grids (`bank.ts` `.bank-grid`), crafting/station recipe list (`crafting.ts`),
prayer grid (`#prayer-grid`), magic panel (`#magic-panel`), world-map side
panels/lists if any scroll.

### Fix plan
- One shared CSS block (inject once; a tiny module both `ui.ts` and the modals'
  CSS strings can reference, or simply include in `HUD_CSS` since it loads first)
  defining a custom scrollbar consistent with the game's parchment/gold/void
  palette (`DESIGN.md`; tokens live in `src/index.css :root` — hard-code the same
  hex values here, since the world client doesn't load the main app's CSS):
  - WebKit: `::-webkit-scrollbar` ~8 px wide, transparent/dark track, rounded
    gold-brown thumb with hover state.
  - Firefox: `scrollbar-width: thin` + `scrollbar-color` on the same containers.
- Apply via a shared class (e.g. add the class to each scrollable container)
  rather than styling `*` — modals created later (bank) must get it too.
- Read `DESIGN.md` before choosing colours (§18 of CLAUDE.md: mandatory for
  UI/UX design work).

### Verification
Manual on Chrome + Firefox, desktop + touch: bank grid, crafting list, prayer and
magic panels all show the custom scrollbar; touch scrolling unaffected.

---

## Item 8 — Bank modal at ~75% of the screen, responsive

**Status**: Done
**Outcome**: `@media (min-width: 700px)` widens `#bank-panel` to
`min(75vw, 1100px)` at `height: 75vh` (the `1100px` cap is the "sensible max"
the plan flagged — otherwise a 4K desktop gets an absurdly large modal);
below that breakpoint the pre-existing `min(560px, 94vw)`/`max-height: 86vh`
sizing is untouched, so phones are no smaller than before. The bank grid
(`.bank-grid.bank-side`) now `flex: 1 1 auto`s to fill whatever height the
panel frees up (with `align-content: start` so a mostly-empty grown grid
doesn't spread its rows out oddly); the pack grid stays `flex: 0 0 auto` /
capped at the old 34vh. Verified with the same scratch harness as item 7:
measured panel rect at 1440×900 comes out to 75.1%×75.2% of viewport, and at
390×844 (phone) 94.5%×66.1% (unchanged natural sizing, well under the 86vh
cap). Escape/backdrop-close (item 5) and the item 7 scrollbars both still
apply.

### Current state
`bank.ts:30-33`: `#bank-panel` is `width: min(560px, 94vw); max-height: 86vh` and
each grid caps at `max-height: 34vh` (`bank.ts:56-59`) — lots of dead screen on
desktop, few visible rows.

### Fix plan
- Panel: `width: min(75vw, sensible-max)` and `height: 75vh` on desktop; keep
  ~94vw/86vh behaviour on small screens (a media query or `min()`/`max()` clamp —
  phones must not get a *smaller* bank than today).
- Grids: `repeat(auto-fill, 44px)` columns already adapt to width — keep 44 px
  cells (tap-target floor, CLAUDE.md §9); make the **bank grid** flex-grow to fill
  the freed height (it's the long list; the pack section stays compact), replacing
  the fixed 34vh caps with flex sizing inside the panel column.
- Both grids keep their (item 7) custom scrollbars when content still overflows.
- Escape/backdrop close behaviour from item 5 must keep working.

### Tests & verification
- `bank.test.ts` covers pure helpers (`filterBankSlots`, `isTapNotDrag`) — no new
  logic expected; if you add a layout-calculation helper, test it.
- Manual: 1440 px desktop — bank fills ~75% each axis, many more rows visible;
  390 px phone — unchanged usability; search, deposit/withdraw menus, drag-scroll
  all still work.

---

## Item 9 — NPCs identical for every player (ambient villagers)

**Status**: Done
**Outcome**: Landed a cleaner variant of the plan's mechanism that avoids the
"cap the catch-up, accept approximate convergence" complexity entirely.
Instead of a per-walker RNG *stream* advanced call-by-call (which would still
need bounded replay for a late joiner), every value is a pure function
*addressed* by its inputs — `hashRand(seed, ...ints)` is a stateless 32-bit
hash, not a PRNG you advance. A walker's path is a sequence of fixed-duration
legs (`AMBIENT_LEG_SECONDS = 4.5`); leg L runs from `waypoint(L)` to
`waypoint(L+1)`, and **both** waypoints are themselves pure functions of L
(`legWaypoints`, reusing the existing `pickWanderTarget` with an
attempt-addressable rand stream) — so any client, at any wall-clock moment,
computes `legIndex = floor(elapsedSeconds / LEG_SECONDS)` and gets the exact
current position in one pass over the walker list (`walkerFramesAt`), with
**zero replay** regardless of how long the walker has "existed." A late
joiner isn't approximately converging within a leg — it's computing the
identical answer. Separation-avoidance stays deterministic via a fixed order
(spec index, then instance index) spanning *all* specs combined (previously
per-spec-call only, so a chicken can now avoid spawning on a villager's
waypoint too — a small behavioural improvement, noted since it wasn't
strictly asked for). Walker identity: `walkerSeed(zoneId, specIndex,
instanceIndex)`. Known trade-off (documented in ambient.ts and tested against
it): the straight line between two individually-walkable waypoints isn't
re-validated tile-by-tile like the old per-frame step check, so a
pathological non-convex wander rect could in theory walk a leg through a
blocked tile — every rect authored so far is a simple open area, so this
hasn't been observed; flagging rather than adding mid-leg pathfinding, which
would reintroduce per-client state. Unit-tested extensively (`tests/ambientWander.test.ts`):
hash/seed determinism, fixed-order separation, and the core guarantee — two
independent calls to `walkerFramesAt` with the same inputs (including a
"joining hours later" instant) produce byte-identical output. Visually
verified with two simultaneous browser sessions teleported into the
`villager_c` ambient rect near the default spawn (`x:173 z:118` in
`overworld.json` — it turns out the humanoid figures visible near the
spawn-town well/furnace throughout this whole session's earlier screenshots
*were* these ambient villagers, not the `cave_goblin` combat NPCs I'd assumed
— cave goblins spawn at `x:189-200 z:67-75`, well away from spawn): both
clients showed the same villager cluster at the same moment, and both showed
matching movement ~6s later (`AMBIENT_LEG_SECONDS` later).

### Root cause (confirmed)
Ambient villagers/critters are **pure client-side decoration** spawned and wandered
with `Math.random()` (`world/client/src/ambient.ts:110-142, 202-213`): every client
sees its own private villagers in different positions doing different things.
Combat NPCs are server-authoritative and already identical for everyone — this item
is about the ambient layer only.

### Fix plan (recommended: deterministic client simulation — no server/protocol change)
- Make the ambient simulation a **pure function of (zone data, wall-clock time)**
  so every client computes identical villagers:
  - Seed a small deterministic PRNG per critter spec (zone id + spec index +
    instance index) for spawn point, initial yaw, and every subsequent wander
    target pick. `pickWanderTarget` already accepts an injected `rand`
    (`ambient.ts:76-92`) — the hooks exist.
  - Replace per-frame `dt` integration with a **fixed-step simulation clocked off
    `Date.now()`** from a global epoch: each client steps the same sequence of
    fixed ticks (e.g. 100 ms) and interpolates rendering between steps. A client
    joining later fast-forwards cheaply (cap the catch-up: beyond a few minutes,
    re-derive from the seed at the current step index rather than replaying — the
    walk is a deterministic function of step count, so design the state so
    fast-forward is bounded, e.g. by capping replayed steps and accepting
    convergence within one wander leg).
- The separation-avoidance input (`avoid` = other walkers' live positions) is
  deterministic too once all walkers are stepped in a fixed order — keep the order
  fixed (spec order, instance index).
- **Alternative (bigger, only if the deterministic sim proves impractical)**:
  promote villagers to server-side non-combat NPCs streamed like monsters. That
  costs protocol + DO tick work and per-player AoI traffic for pure decoration —
  don't start there.

### Tests & verification
- `world/tests/ambientWander.test.ts` exists — add: two independently-constructed
  simulations with the same zone/spec/time produce identical positions at several
  timestamps; a late-joining sim converges with an early one.
- Manual: two browser windows side by side in the same town — villagers stand in
  the same spots and walk the same paths (small transient divergence right at a
  wander-leg boundary is acceptable; note observed behaviour).

---

## Item 10 — Follow another player (right-click → Follow)

**Status**: Done
**Outcome**: Built per plan with one design refinement. Protocol: new
`{ t: 'follow'; targetId: string }` (parsed + tested, valid/malformed/
oversized). Server: `TickPlayer` gained `following`/`followTargetTile`; a new
`updateFollow` in `tick.ts` re-paths via `ctx.pathAdjacent` (stops adjacent,
never onto the target's tile) only when the target's tile has changed since
the last computed path (tested: re-path call count stays flat while the
target is stationary, increments when it moves). Cancel conditions: combat
start (attacking or being attacked) is checked explicitly at the top of
`tickPlayer` — this catches every way combat can start (aggro pull, an
interact/attack, this tick's own aggro check), not just the message handlers;
explicit walk/interact/teleport/craft and the follower's own death/respawn
all clear it via `WorldZone.clearIntents` (which now also clears
`following`); the target leaving the zone is detected in `updateFollow` via
`ctx.players` no longer containing them. A dead **target** isn't specially
detected (players respawn rather than being removed) — the follower simply
re-paths toward wherever they reappear on the next tick, same as any other
movement; noted as a deliberate simplification rather than a bug. Client:
other players are now pickable (`mesh.userData.pick`, `PickKind` gained
`'player'`) but deliberately excluded from `HOVER_PRIORITY` so they're never
a hover/left-click default (tap-to-walk through a crowd is unaffected) —
`buildMenu` gives a player pickable its own "Follow \<name\>" row
(`followTargetId`, not `interact`, since it's a different message) instead of
running it through the normal actions list. Visually verified end-to-end
with two simultaneous browser sessions: right-click near the other player →
"Follow WorldFriend" row appears → clicking it sends `{t:'follow'}`, shows a
"Following WorldFriend." status line, and the follower visibly walks to and
tracks the target as they move away.

### Current state
Other players are deliberately unpickable ghosts — `main.ts:272` ("no pick
target") and `getPickables` (`main.ts:598-603`) exposes only npcs/statics/exits/
loot. There is no follow concept anywhere; movement is server-authoritative
(`{t:'walk'}` → pathfind → per-tick steps in `world/server/tick.ts`).

### Fix plan
- **Protocol** (`world/shared/protocol.ts`): new `ClientMessage`
  `{ t: 'follow', targetId: string }` (and reuse the existing walk/cancel paths for
  stopping). Add to `parseClientMessage` with length-bounded string validation like
  the other id fields, + `protocol.test.ts` cases (valid, malformed, oversized).
- **Server** (`tick.ts` / `WorldZone.ts`): a `following` field on the player state.
  Each tick while following: if the target (another live player in the same zone)
  moved, re-path toward the target's current tile (stop adjacent — pathfind to a
  neighbouring tile, not the occupied tile). Cancel follow on: any explicit walk,
  interact, teleport, combat start, the target dying/leaving/logging out, or the
  follower being attacked. This mirrors "until they click away again" — clicking
  anywhere issues a walk, which cancels. Guard the re-path cost: only re-path when
  the target's tile changed.
- **Client**:
  - Make other players pickable: give their meshes a `userData.pick` of a new
    kind `'player'` (name from the diff) and include `others` in `getPickables`.
    Check `picking.ts` for how hover text + menu rows are built for npcs and
    mirror it (left-click on a player should *not* have a default action — menu
    only, so tap-to-walk through a crowd isn't hijacked).
  - Context menu rows: `Follow <name>`, `Cancel`. On Follow → send the new
    message + a status line via `pushMessage`.
- **PvP note**: this is follow-only; no trade/attack rows. Don't touch pvpLock.

### Tests & verification
- Server: `world/tests/tick.test.ts` (or a new `follow.test.ts`): follower re-paths
  as target moves; stops adjacent; every cancel condition clears the state.
- Protocol: parse tests as above.
- Manual: two windows; right-click player → Follow tracks them around obstacles;
  clicking the ground stops following; target logout stops cleanly.

---

## Item 11 — Show players' hitpoints while in combat

**Status**: Done
**Outcome**: `toEntityDiff` now always includes `hp`/`maxHp` on player diffs
(no protocol change, as expected), and `entChanged` gained an `hp !==
before.hp` clause so a hit that doesn't move the player still streams —
covered by a new server test that runs real combat (a magic monster hitting
an adjacent, stationary player) until a hit lands and asserts `entChanged` on
that exact tick. Client-side, `applyEntityDiff` already applied `hp`/`maxHp`/
`targetId` generically to any entity (self included, since self's own diff
already routes through it) — no wiring change needed there. Added the actual
bar-drawing in `main.ts`'s frame loop for both `self` and each `other`,
gated on `targetId != null || hp < maxHp`, offset below the nameplate
(`toScreen(..., 1.7)` vs the nameplate's `2.0`); `removeOther` now also
calls `removeHpBar` (it previously cleaned up the nameplate/overhead-chat but
not an hp bar, since players never had one before). Verified: the server
test passes; live in the dev client I confirmed the NPC hp-bar code path this
mirrors already renders correctly, and confirmed the world loads two
simultaneous characters (used for a two-window check) — but couldn't reliably
click a wandering goblin via scripted coordinates to trigger live player-vs-
player-visible combat before the session's local D1 instance became flaky
under repeated re-seeding, so the specific "watch another player fight and
see their bar" scenario is unconfirmed live. Static/type/unit-test coverage
is solid; flagging the live two-window check for the maintainer.

### Current state
NPC diffs carry `hp`/`maxHp` and the client draws overhead bars for damaged NPCs
(`main.ts:647-652`). **Player** diffs omit hp entirely — `toEntityDiff`
(`world/server/tick.ts:504-508`) sends only position/anim/name/gear/targetId — so
neither your own character nor other players ever show a bar in the world.

### Fix plan
- **Server**: include `hp`/`maxHp` in player entity diffs (the `EntityDiff` type
  already has the optional fields — no protocol change). Simplest correct rule:
  always include them, and let the client decide when to draw; that matches how
  NPCs work and avoids flicker rules server-side. Confirm diff-emission is
  change-gated (`entChanged`, `tick.ts:500`) so hp changes mark the entity changed
  — otherwise a hit that doesn't move the player never streams its hp.
- **Client**: in the `others` render loop (`main.ts:664-668`), draw the same
  `updateHpBar` used for NPCs when the player is in combat (`targetId` set) or
  recently damaged (`hp < maxHp`), offset below the nameplate so the two don't
  collide; remove the bar via `removeHpBar` when it no longer applies and on
  `removeOther`. Apply the same to **self** (the user asked for "players in
  combat" — include your own overhead bar while fighting; the HP pill stays).
- Sanity-check PvP flag: open-world PvP combat between players isn't live
  (targets are npcIds) — this is display-only, no balance concern.

### Tests & verification
- `tick.test.ts`: player diff now carries hp/maxHp; hp change flips `entChanged`.
- Manual: two windows; watch another player fight a goblin — their bar appears,
  tracks damage, disappears after combat/full heal; own bar shows while fighting.

---

## Item 12 — Open-world hero must match the combat-arena hero

**Status**: Done (stages 1–2 landed; stage 3 dropped per the plan's own
staging — "only start it if stages 1–2 land cleanly")
**Outcome**: Source Quaternius packs were present in this environment (unlike
items 1/2's gitignored Warlord Grondar source), so both stages were built and
rebuilt end-to-end, not just coded.

**Stage 1 (base-model parity)**: `world/scripts/build-hero.mjs` now builds
from the same `Superhero_Male_FullBody` body + Peasant outfit merge as
`scripts/build-arena-hero.mjs` (same technique: merge each outfit part's
mesh, remap its skin onto the base skeleton by joint name), keeping the
world's own clip set/naming (idle/walk/run/mine/attack/attack_ranged/
attack_magic/die — unchanged) rather than the arena's combat clips. Rebuilt
`hero.glb` and committed it. Bone names are identical between the old
Male_Ranger export and the new base (both the "same 65-joint universal rig"
the plan's root-cause analysis already confirmed) — `HIDE_REGION_BONES`
needed no changes. Bind-pose height did shift slightly (~1.87 → ~1.82
units), so `HERO_SCALE` (`entities.ts`) went from 0.85 to 0.873 to keep the
same ~1.59-unit rendered height rather than quietly shrinking the hero;
`build-villagers.mjs`'s independent `target: 1.6` constant (ambient.ts) was
checked and needs no change, since it's pinned to its own posed-bounds
measurement, not derived from `HERO_SCALE`.

**Stage 2 (tint/archetype parity)**: `world/shared/appearance.ts` now prefers
`src/data/equipmentModels.json`'s per-item `tint` (weapons and gear sections)
over the regex `TIER_TINTS` table whenever an item is registered there —
including "registered with no tint" taking precedence over a regex match
(e.g. `staff_of_fire` is registered untinted in the arena registry despite
matching TIER_TINTS' `_of_fire$` rule; the world now renders it untinted too,
matching the arena). TIER_TINTS remains the fallback for the handful of
items the arena registry doesn't cover (e.g. `dragon_claws`). Archetype
selection stays regex-based regardless — the registry has no notion of the
world's small fixed archetype set (sword/axe/bow/…), only a specific model
file per item, so there's nothing to derive there. This surfaced real
existing drift: world's regex `mithril_` tint (`#6274c9`) differed from the
arena registry's per-item mithril tints (`#3f57c4` weapons, `#8c9adc`/`#bcc6d2`
armor) — six `appearance.test.ts` assertions were updated to the arena's
actual values (not just re-recorded blindly — each value was looked up in
`equipmentModels.json`), plus two new tests pinning the registered-but-
untinted and registry-miss-fallback behaviors specifically.

**Stage 3 (coverage parity beyond body/legs — head/hands/feet/cape)**: not
started, per the plan's own "only start it if stages 1–2 land cleanly and
it's the largest chunk" — dropping it here to keep the change reviewable;
flagging for a follow-up rather than doing it partially.

**Verification**: both `cd world && npm run ci` and repo-root `npm run ci`
green (rebuilding `hero.glb` touches a repo-root-visible asset path, and
`appearance.ts` imports `src/data/equipmentModels.json` from `src/`).
Visual: rendered the arena hero via `node scripts/render-arena-hero.mjs`
(bronze_sword + iron_platebody/legs — bald head, Peasant outfit, tinted
gear, as expected) and, separately, drove the dev world client and zoomed on
the player character: same bald head / Peasant-outfit silhouette (previously
a green-hooded Ranger), and the seeded character's `runeforged_scimitar`
rendered in the arena registry's teal (`#2fd0c0`) rather than the old
regex's blue (`#5aa7bd`) — both changes visible in the same screenshot.
Didn't get to cross-check villager/other-player ghost scale visually beyond
the bounds-ratio calculation above (a live two-window scale comparison would
have been the more rigorous check) — noting as a residual gap rather than
skipping silently.

### Root cause (confirmed)
Two different base characters from the same Quaternius packs:
- **Arena** (`scripts/build-arena-hero.mjs` → `public/3d-samples/hero.glb`):
  `Superhero_Male_FullBody` base + Modular Fantasy **Peasant** outfit baked in,
  UAL clips, hide-mask regions, gear attached per `src/data/equipmentModels.json`
  (weapons + full outfit archetypes recoloured by registry `tint`).
- **World** (`world/scripts/build-hero.mjs` → `world/client/public/models/hero.glb`):
  a **Ranger**-outfit character (see the script header + `ambient.ts:29-31`
  comments), its own clip set (idle/walk/run/mine/attack/…), gear via
  `world/shared/appearance.ts` — regex archetype rules + a *duplicated*
  `TIER_TINTS` table, armour limited to body/legs rebinds
  (`entities.ts:301-441`).

Both use the same 65-joint universal rig (that's why the armour rebind works), so
this is an asset/build alignment, not a rig migration.

### Fix plan (staged — stop after stage 2 if time-boxed, record the cut)
1. **Base-model parity**: change `world/scripts/build-hero.mjs` to build from the
   same `Superhero_Male_FullBody` + default-outfit sources as
   `build-arena-hero.mjs`, keeping the **world's** clip set and naming convention
   (idle/walk/run/mine/attack/attack_ranged/attack_magic/die — see
   `entities.ts:143`). The arena script is the reference for source paths and the
   outfit-bake/remap technique. Rebuild `hero.glb`, and check
   `world/scripts/build-villagers.mjs` outputs still read at the same scale
   (villagers borrow the hero-height convention, `ambient.ts:29-31`); update
   `HERO_SCALE` (`entities.ts:14`) and the armour `HIDE_REGION_BONES` if the new
   base's proportions/bone usage differ.
2. **Tint/archetype parity**: make `world/shared/appearance.ts` derive weapon
   archetype + tint from `src/data/equipmentModels.json` entries where they exist,
   keeping the regex rules only as fallback for unregistered items — one source of
   truth for "what colour is mithril" in both renderers. (The world build imports
   from `src/` already — see `main.ts` importing `src/engine/*` — so a data import
   is fine.) Update `world/tests/appearance.test.ts` accordingly.
3. **Coverage parity (stretch)**: extend `world/scripts/build-armor.mjs` +
   `entities.ts` armour slots beyond body/legs (head/hands/feet/cape) using the
   arena's already-tiered outfit exports in `public/3d-samples/outfits/`. This is
   the largest chunk and each slot needs its own hide-region bone list — only
   start it if stages 1–2 land cleanly.

### Tests & verification
- `appearance.test.ts` for stage 2 mapping changes.
- Visual: same character, same equipped loadout, screenshot arena
  (`node scripts/render-arena-hero.mjs --weapon <id> --gear <id,id>`) vs the world
  client — same silhouette, outfit and metal tints. Check other-player ghosts and
  villager scale too.
- Both `cd world && npm run ci` and repo-root `npm run ci` (shared scripts/data
  touched).

---

## Cross-cutting acceptance checklist

- [x] `cd world && npm run ci` green.
- [x] Repo-root `npm run ci` green (required if `src/`, `scripts/`, or `public/` touched — items 1, 2, 12).
- [x] Rebuilt GLBs committed; no gitignored source assets committed.
- [x] Every status row above updated; Outcome lines filled with what actually happened, including dropped/deferred pieces.
- [ ] PR written via the `pr-changelog` skill (player-facing voice; no attribution/internal notes) — not created yet; the delivering session doesn't open PRs unless asked.
- [x] This file retitled to a Decision Record when all items are Done/Dropped.
