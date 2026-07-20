# Open-World Changes — Plan & Build Guide

> **Round 2 spec (2026-07-19) for the builder agent.** Round 1 (the original eight items) shipped in commit `478f8f7` on this branch (PR #819) — its summary is below; the detailed round-1 specs live in git history of this file. **Plan only — no code was changed in this document's commit.** Root causes below were verified in-repo at the cited file:line; re-verify before editing.
>
> Rules of the road: `docs/open-world-build-guide.md` §0 applies (execute in order, verify in-repo, no scope creep, progress log). Changes under `world/**` gate on `cd world && npm run ci`; anything touching `src/**` or `functions/**` also gates on the root `npm run ci`.

## Round 1 — shipped (commit `478f8f7`)

| Item | Where it landed |
|------|-----------------|
| Teleport fix (missing `case 'teleport'` parser) | `world/shared/protocol.ts` + `world/tests/protocol.test.ts` |
| Attack-style persistence (seed from save + write-back on flush) | `world/server/tick.ts` `combatStanceFromSave`, `WorldZone.ts`, `grants.ts` |
| Minimap viewport window | `world/client/src/minimap.ts` (`minimapView`) |
| Sunbearer Ring pins PvE special energy at 100% | `src/engine/combat.js:32,520-524` + `tests/sunbearerRing.test.ts` |
| Prayer on its own HUD tab | `world/client/src/ui.ts` (`TABS`, prayer pane) |
| Bank search | `world/client/src/bank.ts` (`filterBankSlots`) |
| Big world map (button, markers, info cards, wheel zoom, "Travel here") | `world/client/src/worldMap.ts`, `shared/mapClusters.ts`, `shared/zone.ts` `zoneSpawnSummary` |
| Skills audit | Round-1 doc, git history (content programme, one PR per skill — unchanged) |

Round 2 **reverses one round-1 decision**: the world map's "Travel here" button is removed (owner decision 2026-07-19 — travel is walking or Magic-tab teleports only).

## Round 2 priority order

| # | Item | Kind | Size | Notes |
|---|------|------|------|-------|
| 1 | Sunbearer Ring still drains in-world | Bug (P0) | S | Likely deploy skew, not code — verify with a test first. |
| 2 | Remove world-map "Travel here" | Change (P0) | XS | Owner decision; do before anyone gets used to it. |
| 3 | Equipment + World Map tabs → bottom row | UI | S | Frees the top rail; world-map button moves off the viewport. |
| 4 | Prayers ordered highest-level first | UI | XS | One comparator + test update. |
| 5 | Prayer bar: drop the 🙏, show points only | UI | XS | |
| 6 | Teleport list: two per row | UI | XS | |
| 7 | World map: real icons | UI | M | Touches `src/**` (monster icon extraction) → root gate. |
| 8 | World map zoom on mobile/tablet/desktop | UI | M | Pinch + zoom buttons; wheel already works. |
| 9 | Ambient NPCs: human villagers + collision | Feature | M/L | Asset build + zone regeneration + client collision. |

Suggested PR slicing: items 1–6 are one small PR (all `world/**` except nothing — item 1 is test-only), item 7 its own PR (root gate), items 8–9 one PR each or combined at the builder's judgement.

---

## R2-1) Sunbearer Ring still not pinning special energy in the open world (P0)

**Verified in-repo: the branch code already pins it.** The engine drain site skips the drain when the ring is worn (`src/engine/combat.js:520-524`, `hasSunbearerRing` at :32), and the world adapter runs that same engine: `processCombatTick(combat.state, …, player.equipment, …)` (`world/server/combat.ts:249`) with `player.equipment` taken raw from the save (`WorldZone.ts:454`), so `equipment.ring.itemId` is present in engine shape; the world merely mirrors `state.specialAttackEnergy` back (`combat.ts:350`) and forces 100 between fights (`combat.ts:34-37`). The ring slot is equippable in-world (`ui.ts:289`).

**Most likely cause: deployment skew.** The world is a **separate Worker** (`world/wrangler.jsonc`) that bundles `src/engine/combat.js` at *its own* deploy time. Deploying the Pages preview does **not** update `pocketrpg-world-preview` — it must be redeployed from this branch (`cd world && npx wrangler deploy --env preview`) for the engine fix to reach the open world. The user's report almost certainly predates such a redeploy.

**Fix.**
1. **Regression test first** (the deliverable either way): in `world/tests/`, using the `stepCombat` harness pattern of `world/tests/world-hud.test.ts:29,122` — seed a player with `equipment.ring = { itemId: 'sunbearer_ring' }` and a spec weapon, queue `specialAttackQueued`, run ticks until the special fires, assert `player.specialEnergy` stays 100 and no `{e:'spec'}` event below 100 is emitted.
2. If the test **passes** (expected): no code change. Note in the PR that the fix requires redeploying the world worker, and redeploy preview.
3. If it **fails**: the gap is in the adapter path — debug from `combat.ts:249` (equipment shape reaching the engine) before touching the engine.

**Acceptance.** After a world-worker redeploy: equip Sunbearer Ring, fight in the overworld, fire specials back-to-back — the Special bar never leaves 100%.

---

## R2-2) Remove "Travel here" from the world map (P0 change)

**Status quo.** Landmark markers open an info card with a "Travel here" button that sends `{t:'teleport', placeId}` and closes the map (`world/client/src/worldMap.ts:242-253` `showInfoCard` onTravel, wired at :362).

**Fix.** Remove the button and the whole travel path from the map:
- `showInfoCard`: drop the `onTravel` parameter and button (all callers pass info-only cards).
- `openWorldMap`: drop the `onTeleport` parameter; landmark cards keep name/lore/facilities.
- `main.ts` call site: drop the teleport callback (the `{t:'teleport'}` send stays for the Magic tab).
- Delete the now-dead `.wm-travel` CSS rule.

Magic-tab teleports (`ui.ts:685-701`) remain the **only** teleport path; minimap click-to-walk is walking and stays as-is. Do not remove the server `teleport` message handling — the Magic tab uses it.

**Acceptance.** Tapping any world-map marker shows an info card with no travel action; Magic-tab teleports still work.

---

## R2-3) Equipment tab + World Map tab → bottom row (S)

**Status quo.** Top rail = 5 tabs (`TABS`, `ui.ts:386-392`); bottom rail (`hud-tabs bottom`, `ui.ts:563-578`) holds only Logout. The world-map opener is a floating 44×44 button under the minimap (`worldMap.ts:159-169` `initWorldMapButton`, `#worldmap-btn` CSS).

**Fix.**
- Remove `equipment` from `TABS`; build its tab button inside `bottomTabs` instead (before Logout), same `data-tab="equipment"` / `data-icon="paperdoll"` attributes and `tabClicked('equipment')` handler. Pane switching needs **no** change — `selectTab` queries `.hud-tab[data-tab]` globally (`ui.ts:399`), not by container.
- Add a **World Map** tab to `bottomTabs` (icon key `globe` — already in `bespokeIcons.json`; painted by `paintHudIcons`). It is an *action*, not a pane: give it **no** `data-tab` attribute (so `selectTab` ignores it and it never shows an active state); `click` → new `HudHandlers.onWorldMap()`.
- `main.ts`: move the `openWorldMap({...worldMapData, self: …})` wiring from `initWorldMapButton` into the `onWorldMap` handler passed to `initHud`. Delete `initWorldMapButton` and the `#worldmap-btn` CSS block.
- Bottom row layout: Equipment (44px) + World Map (44px) + Logout (flex-fills the rest). Keep `#hud-panel` at 232px — the inventory/equip grids are sized for it; the 4-tab top rail simply gains breathing room.
- Note the collapse behaviour: `tabClicked` on the active tab collapses the body (`ui.ts:410-418`) — verify Equipment still collapses/reopens from the bottom row.

**Tests.** None practical (node-env suite, no DOM); manual acceptance on phone + desktop widths.

**Acceptance.** Top rail shows Inventory/Combat/Prayer/Magic; bottom row shows Equipment, World Map, Logout, all ≥44px targets; Equipment pane opens/collapses from the bottom row; World Map tab opens the map without disturbing the active pane.

---

## R2-4) Prayers ordered highest level first (XS)

**Status quo.** `categorisePrayers` sorts level-**ascending** (`world/shared/prayer.ts:54`); `renderPrayerPanel` renders Protection then Combat sections from it (`ui.ts:764-798`).

**Fix.** Change the comparator to `b.level - a.level` in `categorisePrayers` (it feeds only the HUD panel). Keep the two sections exactly as they are.

**Tests.** Update `world/tests/prayer.test.ts:84-90`: protection order becomes `protection_from_melee, protection_from_missiles, protection_from_magic`; the combat monotonicity assertion flips to non-increasing. Keep the level-gating and skill-tag tests untouched.

**Acceptance.** Prayer tab lists Piety/Rigour/Augury-tier prayers first in Combat; Protect from Melee first in Protection; separate section headers unchanged.

---

## R2-5) Prayer bar: remove the icon, show level + remaining points (XS)

**Status quo.** The pool bar label renders `🙏 ${points}/${max}` (`ui.ts:807` in `setPrayerState`) and is seeded as `'🙏 Prayer'` at build (`ui.ts:541`). The 🙏 emoji is not the game's prayer icon — that's the `prayer` bespoke key used on the tab itself.

**Fix.** Drop the emoji from both sites: label becomes `${Math.ceil(points)}/${max}` (the max **is** the Prayer level, so this reads as remaining/level exactly as requested); the build-time seed can be `''` — `setPrayerState` runs on every welcome (`main.ts:363`) before the player can see the pane.

**Acceptance.** Prayer tab bar reads e.g. `43/52` with no icon; drains/toggles update it as before.

---

## R2-6) Magic-tab Teleport list: two per row (XS)

**Status quo.** `.tp-list` is a single flex column (`ui.ts:120`), one full-width row per destination — 14 overworld places = a long scroll.

**Fix.** `.tp-list { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; }`. On `.tp-row`, keep `min-height: 40px` (44px effective target with padding) and add `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` for the longer place names at half width. No TS changes.

**Acceptance.** Teleport section shows two destinations per row, names legible (ellipsised if needed), taps still land correctly.

---

## R2-7) World map: use the game's actual icons (M — root gate)

**Status quo.** All markers are generic emoji from `CATEGORY_EMOJI` (`worldMap.ts:63-65`): every monster is ☠️, banks 🏦, etc. Only place markers already use their real `world.json` icon.

**Fix — replace `CATEGORY_EMOJI` with the game's own art.** The world client already lazy-loads `bespokeIcons.json` + `gameIcons.json` and exposes `uiIconMarkup(key, px, color)` (`world/client/src/itemIcon.ts:31`); the map opens post-welcome, after `loadItemIcons()` has resolved (same guarantee `paintHudIcons` relies on), so SVG markup is safe in marker elements.

| Category | Icon | Source of truth |
|----------|------|-----------------|
| Bank | `uiIconMarkup('coins')` | Main game's bank glyph — `FacilityGlyph`, `src/screens/WorldMapScreen.jsx:29` |
| Smithing | `uiIconMarkup('anvil')` | `SKILL_ART.smithing`, `src/utils/skillArt.js` |
| Cooking | `uiIconMarkup('cooking_pot')` | `SKILL_ART.cooking` |
| Mining | `uiIconMarkup('mining')` | `SKILL_ART.mining` |
| Woodcutting | `uiIconMarkup('wood_axe')` | `SKILL_ART.woodcutting` |
| Exit | `uiIconMarkup('door')` | Logout glyph (gameIcons fallback path) |
| Place | `world.json` `icon` emoji | Already correct — keep |
| Monster | **Per-monster emoji** from the main game's `MONSTER_ICONS`, fallback `'👹'` | Currently inlined at `src/screens/CombatScreen.jsx:191` |

**Monster icon extraction (the root-gate part).** `MONSTER_ICONS` is buried in a screen file the world can't import. Extract it to a new **`src/utils/monsterIcons.js`** exporting the map (do **not** use a new JSON file — a JS module is the pattern `build_single.cjs` handles; register it in `sourceFiles`; it carries no UI imports so core placement is safe. It's referenced by `CombatScreen` only inside render, so no eval-time cross-module read — §12). Update `CombatScreen.jsx:191,1804` to import it; `SlayerScreen.jsx:38` keeps its own smaller map (different art choices — leave it, flag only). World map imports the same module for per-monster emoji.

Marker rendering: `addMarker` sets `innerHTML` to the SVG markup (or emoji text for places/monsters); keep the 44px marker box and count badge as-is. Optionally give SVG markers a subtle circular backing (`rgba(20,16,10,0.7)` disc) so pale icons read against grass — builder's judgement, keep it one CSS rule.

**Gates/tests.** Root `npm run ci` (touches `src/**` + `build_single.cjs`). Add a tiny root test asserting `monsterIcons` keys are all valid `monsters.json` ids (catches typos at extraction). World side: no new pure logic.

**Acceptance.** Map markers show the same art the game uses: coins for banks, anvil/pot/pick/axe for skilling, each monster its own emoji (chicken 🐔, bull 🐄, …); places unchanged; main-game Combat screen icons unchanged.

---

## R2-8) World map zoom on mobile / tablet / desktop (M)

**Status quo.** Wheel zoom only (`worldMap.ts:405-418`); single-pointer drag pan; `touch-action: none` already set on the viewport (CSS :110). Mobile/tablet cannot zoom at all.

**Fix.**
- **Extract the zoom-about-a-point math** (the wheel handler's world-point-fixed transform update + clamp) into an exported pure helper, e.g. `zoomAt(transform, cx, cy, newZoom, limits)` mutating/returning `{panX, panY, zoom}` — wheel, pinch, and buttons all call it, and the node-env suite can test it.
- **Pinch**: track active pointers in a `Map<pointerId, {x,y}>` from the existing pointerdown/move/up handlers. With two pointers: each move computes the new midpoint + distance; `zoomAt(midX, midY, zoom * newDist/prevDist)`; suppress pan-drag while two pointers are down; on dropping to one pointer, reset the drag anchor (avoid the classic pinch-release jump).
- **Zoom buttons**: two 44×44 `+` / `−` buttons overlaid bottom-right of the viewport, each `zoomAt(viewportCentre, zoom × 1.4)` / `÷ 1.4` — gives desktop-without-wheel and any struggling touch device an escape hatch.
- Keep the existing `fitZoom×1 … fitZoom×4` clamp and `clampPan`.

**Tests.** `world/tests/`: `zoomAt` keeps the anchor's world point fixed on screen; clamps at min/max; pan stays clamped after zoom-out at a corner.

**Acceptance.** Pinch-zoom works on a phone/tablet; wheel still works on desktop; buttons work everywhere; markers stay 44px and correctly positioned at every zoom (they already reposition via `reposition()`).

---

## R2-9) Ambient NPCs: human villagers that respect collision (M/L)

**Status quo (verified).** The non-attackable "little creatures" are the **ambient critter layer** (`world/client/src/ambient.ts`) — client-render-only chickens/frogs (`CRITTERS` :17-20) doing a pure random walk inside an authored rectangle with **no collision at all** (:53-71), so they stroll through walls, market stalls and trees the player can't. They also use the same animal models as *attackable* monsters (`field_chicken` is a real combat npc), which is the confusion being reported. Server-side combat NPCs already respect collision (`npc.ts:212` wander, `:244` chase) — they are **not** the offenders.

> Interpretation note: the request reads "make all NPCs that you *can* fight human", but the surrounding sentence makes clear the intent is the inverse — **non-attackable ambient NPCs become humans; attackable monsters stay monsters**. Confirm with the owner only if the builder disagrees after reading the request.

**Fix — three parts.**

1. **Villager models.** New `world/scripts/build-villagers.mjs` following the `build-hero.mjs` pattern (Quaternius **Universal Base Characters[Standard]** + **Modular Character Outfits - Fantasy[Standard]** under `assets/open-world/Quaternius/`; paid-license packs — process into small committed GLBs, never copy raw). Produce 2–3 variants (e.g. `villager_a/b/c.glb`, differing outfit/tint) into `world/client/public/models/`. Static pose is fine — the ambient layer animates by bob, not skeletal clips (`ambient.ts:11-12,69`). Register each in `CRITTERS` with baked bounds (measure with `world/scripts/inspect-glb.mjs`) and a human-scale `target` height ≈ 1.4 tiles.
2. **Zone data.** Zone JSONs are **generated** — change the ambient specs at the source, not the output: `world/scripts/gen-varrick.mjs:301-…` (street hens → villagers) and the `lumbright.json` ambient block (`:1809`, hand-authored) which `gen-overworld.mjs:102-103` merges into the overworld. Replace every critter `model` with a villager variant (the request says *all* non-attackable walkers become human — including field/marsh critters; flag, don't second-guess). Regenerate and commit `world/zones/overworld.json` (+ varrick if regenerated).
3. **Collision.** Thread the zone collision grid into `createAmbient` (the welcome handler has it — `main.ts:449` already passes `heightField.heightAt` from the same scope). Rules: a new wander target must be a walkable tile (`collision[tz]?.[tx] === '.'`); each update, if the tile the critter is about to enter is blocked, discard the target and pick a new one instead of stepping in. Extract the target-pick/step-check as pure exported helpers so the node suite can test them (same precedent as `minimapView`).

**Tests.** Pure helpers: target picking never returns a blocked tile (seeded rects with walls), step-check refuses entering `#`, and a fully-blocked rect degrades gracefully (critter stands still, no infinite loop — bound the retry count).

**Acceptance.** Towns show wandering villagers (visibly human, not attackable, no interaction); no ambient walker ever overlaps a building/prop/blocked tile; attackable monsters look unchanged; performance unchanged (same instance counts).

---

## Cross-cutting notes for the builder agent

- **Two CI gates.** `world/**`-only items (1–6, 8, 9): `cd world && npm run ci`. Item 7 touches `src/**` + `build_single.cjs` → root `npm run ci` too. Never commit generated `index.html`/`game-*.js`.
- **World worker deploys separately.** Nothing under `world/**` (or the engine it bundles) reaches players via the Pages deploy — `pocketrpg-world` / `pocketrpg-world-preview` need their own `wrangler deploy` (see R2-1). State this in the PR so testing skew doesn't get re-reported as a bug.
- **World UI has no DOM test env** — testability comes from extracting pure helpers (`minimapView`, `filterBankSlots` precedent). Don't add jsdom.
- **PR bodies are the public changelog** (CLAUDE.md §19 / `pr-changelog` skill): player-facing voice, no attribution/session/GitHub links.
- **Manual acceptance** for items 3, 5, 6, 7, 8 on a phone-sized viewport as well as desktop; item 9 needs a visual pass in Varrick + Lumbright + the farm fields.
