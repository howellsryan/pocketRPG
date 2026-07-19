# Open-World Changes — Plan & Build Guide (2026-07-19)

> Spec for the builder agent covering the eight requested open-world items: prayer tab, minimap, Sunbearer Ring, attack-style persistence, bank search, missing-skills audit, broken teleports, and a full-screen world map. **Plan only — no code was changed in this document's PR.** Root causes below were verified in-repo at the cited file:line; re-verify before editing (files may have moved).
>
> Rules of the road: `docs/open-world-build-guide.md` §0 applies (execute in order, verify in-repo, no scope creep, progress log). Changes under `world/**` gate on `cd world && npm run ci`; anything touching `src/**` or `functions/**` also gates on the root `npm run ci`.

## Priority order

| # | Item | Kind | Size | Why this order |
|---|------|------|------|----------------|
| 1 | Teleport fix | Bug (P0) | XS | One-line root cause; unblocks travel and the big map's "Travel here". |
| 2 | Attack-style persistence | Bug (P0) | S | One seed site + optional write-back; daily annoyance. |
| 3 | Minimap viewport | Bug (P1) | M | Broken since the merged overworld shipped. |
| 4 | Sunbearer Ring effect | Bug/feature (P1) | S | Deferred effect, touches `src/engine` (root gate). |
| 5 | Prayer tab | UI (P1) | S | Pure client HUD reshuffle. |
| 6 | Bank search | UI (P2) | S | Pure client. |
| 7 | Big world map | Feature (P2) | M/L | Depends on #1 (teleport) for its travel action. |
| 8 | New skills | Content programme | — | Audit + per-skill recipes; each skill is its own future PR. |

Suggested PR slicing: **PR A** = items 1+2 (server fixes), **PR B** = items 3+5+6 (client UI), **PR C** = item 4 (engine, root gate), **PR D** = item 7. Item 8 spawns its own PRs later.

---

## 1) Fix teleporting — "Reconnecting" instead of teleporting (P0)

**Root cause (verified).** `parseClientMessage` in `world/shared/protocol.ts` has **no `case 'teleport'`**. The `ClientMessage` union declares `{ t: 'teleport'; placeId: string }` (protocol.ts:47) and the client sends it (`main.ts:135` `onTeleport`), and the server switch handles it (`WorldZone.ts:656`) — but the parser returns `null` for any unlisted `t`, and `WorldZone.onMessage` responds to a null parse with `connection.close(1008, 'invalid_message')` (WorldZone.ts:285-288). Every teleport click kills the socket; the player sees the connection banner / login flow instead of a snap.

**Fix.**
- `world/shared/protocol.ts` `parseClientMessage`: add
  ```ts
  case 'teleport': {
    const placeId = (raw as Record<string, unknown>).placeId
    return typeof placeId === 'string' && placeId.length > 0 && placeId.length <= 64 ? { t: 'teleport', placeId } : null
  }
  ```
  (mirror the `pray`/`unequip` cases at protocol.ts:275-282).
- No server-side change needed — `handleTeleport` (WorldZone.ts:1013-1030) is correct: same-zone snap, clears intents/aggro, checkpoints, sends `{t:'snap'}`. All 14 overworld landmark centre tiles were verified walkable (`.`), so its collision guard passes.

**Tests.** Add a `parseClientMessage` round-trip case for `teleport` (valid, missing placeId, over-length) next to wherever the parser is currently exercised (`world/tests/net.test.ts` or a new `protocol.test.ts`). **Guard for the future:** add one test that iterates every `t` literal in the `ClientMessage` union (hand-maintained list) and asserts `parseClientMessage` accepts a well-formed instance — this class of bug (union extended, parser forgotten) has now happened once.

**Acceptance.** In the overworld, Magic tab → tap a Teleport row → hero snaps to the place centre with no disconnect; socket stays open (chat still works immediately after).

---

## 2) Attack styles reset on every refresh (P0)

**Root cause (verified).** The world session hardcodes `stance: 'accurate'` when seeding a player (`world/server/WorldZone.ts:510`). The main game persists the player's stance in the save blob at `settings.combatStance` (written via `saveSetting('combatStance', …)` in `src/state/gameState.jsx:882`; rides the save as `settings.combatStance`, see `src/db/saveload.js:23`). The world never reads it, so every refresh/reconnect/zone-change resets to Accurate.

**Fix (two halves).**
1. **Seed from the save** — in `WorldZone.handleHello`, where `stats`/`equipment`/`bankView` are already pulled from `saveObject` (WorldZone.ts:445-458), read `(saveObject.settings as { combatStance?: string })?.combatStance` and map it into the world's `CombatStance` union (`'accurate' | 'aggressive' | 'defensive'`, protocol.ts:17). Anything else (`'controlled'` legacy, `'rapid'`, undefined) → `'accurate'`. Use it at the `stance:` field of the Player seed. The client already renders `message.you.stance` via `setStanceActive` on welcome and resync (main.ts:356, 535) — no client change.
2. **Write back on flush (recommended, keeps the two apps in sync both directions)** — add optional `combatStance?: string` to `GrantPayload` (`world/server/grants.ts:14`), include it in the flush when the player changed stance during the session (track a `stanceDirty` flag set in the `setStance` case, WorldZone.ts:636-640). In `flushGrants`, apply it to `saveObject.settings = { ...settings, combatStance }` before `writeSave`, and update `isEmptyPayload` (grants.ts:63) so a stance-only change still flushes. Add it to the `auditLog` payload fields. This mirrors the existing `equipment` snapshot pattern (grants.ts:31-34, 170).
   - If the reviewer wants a smaller diff, half 1 alone fixes the reported bug (the world then always mirrors the main game's stance at entry); half 2 makes an in-world stance change survive into the main game. Do half 1 first, half 2 in the same PR if uncontroversial.

**Tests.** `world/tests/`: a seed-mapping unit test (extract the `saveStance → CombatStance` mapper as a pure function in `world/server/` or `world/shared/` so it's testable without the DO); if half 2 lands, extend `world/tests/grants*.test`-style coverage: payload with `combatStance` mutates `saveObject.settings.combatStance` and a stance-only payload is not "empty".

**Acceptance.** Set Aggressive in the PocketRPG game → enter world → Combat tab shows Aggressive. Change to Defensive in-world, refresh → still Defensive (half 2: and the main game now shows Defensive too).

---

## 3) Minimap not functioning / rendering (P1)

**Root cause (verified).** `createMinimap` (`world/client/src/minimap.ts:42`) scales the **whole zone** into a 132px square: `cell = 132 / max(w, h)`. That was fine for 32-64-tile zones, but the merged overworld (PR #816) is **348×213** (`world/zones/overworld.json`), so `cell ≈ 0.38px`: every tile is painted as an overlapping 1px `ceil` rect (a smeared blob), the 3.2px self-dot covers ~8 tiles, NPC/other dots are unreadable, and a tap maps to a tile potentially hundreds of tiles away (then walks there through `findPath` across the whole continent). Net effect: "not functioning or rendering" on the map that players actually inhabit.

**Fix — viewport minimap.** Keep the DOM/canvas approach; change what's drawn:
- **Bake once, full-map, offscreen** at a fixed ≥2px/tile scale (`348×213 → 696×426` canvas; cheap). Reuse the existing palette logic (walkable/blocked, `palette?.walkableA/blockedA`).
- **Each `update()`**, blit a **window of `VIEW_TILES = 41` tiles (±20)** centred on the player from the baked canvas into the 132px square (`drawImage` sub-rect → destination). Clamp the window at map edges (small zones like `lumbright` 64×64 will show a third of the map — fine; if `max(w,h) <= VIEW_TILES` just show the whole zone, which preserves today's behaviour for small zones).
- **Dots**: convert tile → viewport px through the same window transform; skip dots outside the window. Self stays centred (except at edge clamp).
- **Click-to-walk**: map the tap through the window transform so it targets a **nearby** tile; keep the `collision` walkability guard. This also kills the accidental cross-continent walks.
- Extract the window/transform maths as a pure exported helper (e.g. `minimapView(selfX, selfZ, w, h, viewTiles)` returning `{x0, z0, tilesShown, toPx(tileX,tileZ)}`) so it's unit-testable in the node-env world suite (UI modules are only testable through pure exports — see `isTapNotDrag` precedent in `bank.ts:21`).

**Files.** `world/client/src/minimap.ts` (all of it), `world/client/src/main.ts:561` (call site unchanged apart from any new arg), new `world/tests/minimap-view.test.ts`.

**Tests.** Pure-math cases: centred window, edge clamps (player at 0,0 and at w-1,h-1), small-zone whole-map mode, tile↔px round trip, click mapping.

**Acceptance.** In the overworld: minimap shows readable local terrain that scrolls as you walk; NPC dots match monsters on screen; a tap walks a short local distance. In `lumbright` the minimap still renders sanely.

---

## 4) Sunbearer Ring — pin special energy at 100% (P1)

**Status quo (verified).** The effect was **never implemented** — `docs/tomb-of-arasmus-implementation.md:312`: "Sunbearer Ring: 2× special-attack energy regen — ⏳ DEFERRED… no regen hook yet." The item (`src/data/items.json` `sunbearer_ring`, legacy `lightbearer`) is a zero-stat ring. PocketRPG's PvE special model has no passive regen to double (energy starts each fight at 100, drains on use, refills on kill — CLAUDE.md §7), so the owner's chosen semantics are: **while `sunbearer_ring` is equipped, special energy never drains — it stays at 100%.**

**Fix.** In the engine, at the single PvE drain site `src/engine/combat.js:511-514` (inside `processCombatTick`, which already receives `equipment`): if `equipment?.ring?.itemId === 'sunbearer_ring'`, skip the drain (leave `state.specialAttackEnergy` unchanged; it is already 100 at fight start and after each kill). `canAffordSpecialAttack` then always passes, so specials fire back-to-back subject only to attack timing. Prefer a tiny named helper (e.g. `hasSunbearerRing(equipment)`) beside the other set-check helpers (combat.js:326+).
- **Do NOT touch PvP** (`src/engine/pvpEngine.js` has its own energy model under §10's path-scoped rules) — pinning energy in PvP is a balance decision nobody signed off. Flag it in the PR body as deliberately excluded.
- The world server needs **zero changes**: `world/server/combat.ts` mirrors `state.specialAttackEnergy` into `player.specialEnergy` after every engine tick (combat.ts:350), so the pinned value flows to the world HUD automatically. Same for the main game's spec bar.

**Docs (required, §16).** Add the ring's effect to `docs/game-guide.md`, run `npm run gen:knowledge`, commit the regenerated index. Update `docs/tomb-of-arasmus-implementation.md:312` from DEFERRED to shipped-with-changed-semantics (pin, not 2× regen).

**Tests (root suite).** In `tests/`: with the ring equipped, firing a special leaves energy at 100 and a second special can fire immediately; without the ring, the same weapon drains normally; percent-cost specials (`energyCostPercent`) also stay at 100.

**Gate.** This touches `src/engine/` → full root `npm run ci`.

**Acceptance.** Equip Sunbearer Ring in the main game, fight anything with a spec weapon: spec bar never leaves 100%. In the world, same behaviour on the Combat tab's Special bar.

---

## 5) Prayers on their own HUD tab (P1)

**Status quo.** Prayers render inside the **Combat** pane: `#prayer-bar` + `#prayer-grid` are appended after the spec button in `initHud` (`world/client/src/ui.ts:522-535`), with `renderPrayerPanel`/`setPrayerState` (ui.ts:752-801) targeting those ids. The tab rail is the `TABS` array (ui.ts:385-390): Inventory / Equipment / Combat / Magic, painted with bespoke icon keys.

**Fix.**
- Add `{ id: 'prayer', iconKey: 'prayer', title: 'Prayer' }` to `TABS` (the `prayer` key exists in `src/data/bespokeIcons.json` — verified). Build a fifth `hud-pane` (`data-pane="prayer"`) and move the `#prayer-bar` + `#prayer-grid` creation into it; the Combat pane keeps stances, spell button, spec bar/button only. `renderPrayerPanel`/`setPrayerState` need no signature changes (they look elements up by id).
- **Rail width**: `#hud-panel` is 181px and `.hud-tab` has `min-width: 44px` (ui.ts:29,34) — five tabs need ≥ 5×44 + 4×3px gap = **232px**. Do **not** shrink tap targets below 44px (§9 hard rule). Recommended: widen `#hud-panel` to 232px and let the panes centre their content (`#inv-panel`/`#equip-panel` are fixed-width grids — give `.hud-body` `display:flex; justify-content:center` or add horizontal padding). Check `#run-orb`/`#hp-pill` offsets (`right: 148px`, ui.ts:135,206) still clear the wider panel; adjust to keep 8px gap.
- Nothing server-side changes; prayer events (`{e:'prayer'}`) and the `pray` message are untouched.

**Tests.** UI-only; world suite is node-env, so cover any extracted pure helper if one appears — otherwise this item is manual-acceptance only (list it in the PR checklist).

**Acceptance.** Five tabs render with 44px targets; Prayer tab shows pool bar + Protection/Combat toggle sections; toggling works mid-fight; Combat tab no longer shows prayers; collapse-on-retap still works for all five.

---

## 6) Bank search (P2)

**Status quo.** The bank modal (`world/client/src/bank.ts`) renders every bank entry into `#bank-grid` and distinct pack items into `#bank-pack-grid` (bank.ts:189-214). No filtering. Banks accumulate hundreds of item types, so this is already unusable late-game.

**Fix.**
- Add a search `<input>` row under `.bank-head` (id `bank-search`). On `input`, re-run `render()` with the query applied to **both** grids. Filter = case-insensitive substring of `itemName(itemId)` (from `./itemIcon`). Empty query = current behaviour. Show "No items match" in the same style as the existing empty-bank row (bank.ts:199-204).
- Keyboard hygiene: `stopPropagation` on `keydown` (the pattern `#chat-input` uses, ui.ts:915-922) so typing doesn't leak into game hotkeys; `Escape` clears then blurs. Clear the query on `openBankUI`/`closeBankUI` (fresh state per visit; `state` is already reset there).
- Extract the filter as a pure export — `filterBankSlots(slots: {itemId: string}[], query: string, nameOf: (id: string) => string)` — so the node-env suite can test it (same pattern as `isTapNotDrag`, bank.ts:21).
- Style with the existing bank CSS variables/colours; input min-height 36-44px for touch.

**Tests.** `world/tests/bank.test.ts`: filter cases — empty query passes all, substring matches, case-insensitivity, no-match.

**Acceptance.** Open a chest, type "rune" → both grids shrink to matching items live; deposit/withdraw taps and qty menus still work on filtered cells; closing and reopening the bank clears the query.

---

## 7) Big world map — new button, icons + place info (P2)

**Goal.** A button that opens a full-screen map of the current zone with icons and info for every interactive thing: places, banks, skilling nodes, processing stations, monster areas, exits — plus the player's position, and (overworld) a "Travel here" action per place.

**Data plumbing (small server change).**
- Already in the welcome `zone` payload: `collision`, `w/h`, `ground` regions, `palette`, `landmarks`, `exits`, and **all** static objects zone-wide via `statics` (`sendWelcome`, WorldZone.ts:529-572 — `bank_chest`×11, `furnace`/`anvil`/`range`×7 each, `rock`, `tree`; verified in `world/zones/overworld.json`).
- **Missing: monster spawn locations** — live NPCs only stream inside the AOI. Add a static spawn summary to the welcome zone payload: `spawns: { monsterId: string; x: number; z: number }[]` derived from `this.zone.npcs` (spawn definitions, not live positions — no live-tracking leak). Extend the `welcome` type in `protocol.ts:147` and `sendWelcome`. Overworld has ~12 spawn entries; trivial payload.
- **Place info cards**: the 14 overworld landmark ids exactly match `src/data/world.json` place ids (verified). The client already imports `src/data/*.json` (main.ts:24-27), so import `world.json` and pull `name`, `icon`, `sub`, `lore`, `facilities` per landmark for the info card. Guard for landmarks with no `world.json` entry (render label only).

**UI spec (new module `world/client/src/worldMap.ts`, mirroring `minimap.ts`/`bank.ts` conventions — plain DOM/canvas, CSS injected once, pure helpers exported).**
- **Button**: fixed 44×44 button directly under the minimap (top-right column), bespoke icon key `globe` (exists in `bespokeIcons.json` — verified), painted via the `data-icon` + `paintHudIcons` mechanism (ui.ts:726-737). Toggles the map; `✕` and backdrop-tap close (modal pattern of `bank.ts:216+`).
- **Canvas layer**: full-screen overlay; render the zone from `collision` + `ground` regions (resolve per-tile kinds with the existing shared `groundKindGrid` — `world/shared/groundKinds.ts:54` — and paint each kind's `color`; water tiles included), walkable/blocked base from the palette. Bake once per open at a scale that fits `min(90vw, 90vh)`; support pinch/wheel zoom ×1–×4 and drag pan (v1 can ship fixed-fit + zoom later if time-boxed, but the overworld at 348 tiles across really wants zoom — recommend shipping it).
- **Marker layers** (DOM pins or canvas sprites, ≥24px, tap target ≥44px via padding):
  - Places: `landmarks` with `world.json` `icon` emoji + label.
  - Banks: `statics` with `type === 'bank_chest'`.
  - Smithing: `furnace` + `anvil`; Cooking: `range` (cluster same-type markers within ~3 tiles into one pin with a count).
  - Mining: `rock`; Woodcutting: `tree` (cluster; a forest of 16 trees is one "Woodcutting" pin per cluster).
  - Monsters: the new `spawns` summary → pin per spawn showing name + combat level from `monsters.json` (already imported in main.ts).
  - Exits: `exits` (present in `lumbright`, not the overworld).
  - Self: pulsing dot at the player's tile at open time (static is fine for v1; live-update if the map stays open is a nice-to-have).
- **Info card**: tapping a marker opens a small panel: icon, name, what's here (facility list / monster level / node skill + level requirement from `skills.json` actions where derivable), and for landmarks a **"Travel here"** button that sends the existing `{t:'teleport', placeId}` (depends on item 1) and closes the map.
- **Filter chips** (v1 optional, recommended if cheap): toggle rows for Places / Banks / Skilling / Monsters, matching the request's "skills, monster locations, banks".

**Tests.** Pure helpers: marker clustering, tile→canvas transform, spawn-summary shaping (server side: a `sendWelcome` unit is impractical, but the `spawns` derivation from a zone def can be a pure function in `world/server/zones.ts` or `shared/` with a test). Everything visual is manual acceptance.

**Acceptance.** Button visible in the overworld and lumbright; map shows terrain + all marker classes; tapping Varrick's pin shows its card and "Travel here" snaps you there; markers match reality (bank pin at Lumbright is where the chest is); performance fine on mobile (single bake, no per-frame work while closed).

---

## 8) Skills audit — what's missing and how to add each

**In the world today** (verified against `world/server/`, `world/shared/recipes.ts`, zone data): Mining and Woodcutting (depleting-node gather loop, `mining.ts` + `tick.ts`), Smithing (furnace + anvil stations), Cooking (range station), Prayer (toggle + drain in combat), Magic (combat autocast + landmark teleports), and the combat stats (Attack/Strength/Defence/Hitpoints/Ranged with ammo). Skill *spells* are explicitly stubbed out (main.ts:122-125).

**Missing** (from `src/data/skills.json`'s 17 skills, minus the above): **Fishing, Firemaking, Fletching, Crafting, Herblore, Agility, Thieving, Farming, Hunter, Runecraft, Dungeoneering** — plus Slayer and Construction, which live outside `skills.json` and should stay main-game-only (they're account-progression systems, not tile activities).

Recommended implementation recipes, cheapest first — each is one PR, each drives data **only** from `skills.json` actions (never hand-authored rates, per the recipes.ts precedent):

| Skill | Mechanic recipe | New pieces needed | Size |
|-------|-----------------|-------------------|------|
| **Fishing** | Node-gather reskin: fishing spots as non-depleting (or slow-cycling) node objects; `fishing.actions` drive level/ticks/xp/product exactly like `GATHER_SKILLS` (`mining.ts:25`) — add a third entry with verb `fish`. | Water tiles already exist as a ground kind; a `fishing_spot` object type + model/marker; anim choice (build guide Phase 8 notes UAL has candidates). | S/M |
| **Firemaking** | Inventory action, not a node: "Light" on logs (extend `shared/itemActions.ts` primary/secondary actions) → consumes log, ticks, XP, spawns a temporary fire prop on the player's tile. | Item-action plumbing + a transient world object with TTL (rock-respawn timer pattern reversed). | S/M |
| **Fletching** | Station-less recipe panel: "Craft" on a knife (or a fletching bench object if we prefer stations) opens the existing recipe panel (`crafting.ts` client + `handleCraft` server) fed by `fletching.actions`. The station framework already does multi-input consumption + per-tick output. | One new `STATIONS`-style entry keyed off an inventory tool instead of a static object — or simpler: add benches as statics and change nothing structural. | S |
| **Crafting** | Same as Fletching (`crafting.actions`, spinning wheel / tanning as statics). | Same. | S |
| **Herblore** | Same recipe-panel pattern (`herblore.actions`); no station needed (pestle in pack) or an apothecary bench static. | Same. | S |
| **Runecraft** | Station recipe with one twist: altars as statics, essence → runes via `runecraft.actions`; multiplier-per-level rules if the main game has them (check the actions data before designing). | Altar statics (one per element, placed at themed overworld spots). | M |
| **Thieving** | New loop: "Pickpocket" NPC interact → ticks → success roll (level-based from `thieving.actions`) → loot or stun+damage. First *interactive-NPC* (non-combat) mechanic. | NPC interact verb + a stun state on the player; market-stall variant can reuse depleting nodes. | M |
| **Agility** | Course of obstacle statics; interacting with each in sequence teleport-hops the player along a fixed path with ticks + XP, lap bonus from `agility.actions`. Varrick already has a generated rooftop course layout (`gen-varrick.mjs:111`). | Obstacle statics + forced-movement step (snap-based; the `snap` message already exists). | M/L |
| **Farming** | Time-based, survives logout → needs durable per-player patch state (D1 or DO storage keyed per char, checked on interact — *not* per-tick writes). Plant → wait wall-clock → harvest. | New persistence + growth-check on interact; patches as statics. | L |
| **Hunter** | Trap objects the player places (transient world objects with owner + timer), check-trap interact. | Owner-scoped transient objects. | L |
| **Dungeoneering** | Skip as a skill; the Varrick dungeon zone already delivers the *content* shape. XP for it stays main-game. | — | — |

Sequencing recommendation: **Fishing → Fletching/Crafting/Herblore (one "recipe panel" PR each, trivially parallel) → Firemaking → Thieving → Runecraft → Agility → Farming/Hunter.** Each new skill's nodes/stations should also be placed on the big map (item 7) via the same statics/marker pipeline — no extra work if item 7 keys markers off object `type`.

Every skill PR: XP flows through the existing `pendingXp` → `flushGrants` path untouched (client-trusted per §14 is *not* in play here — world XP is server-computed and server-flushed); update `docs/game-guide.md` + `npm run gen:knowledge` when the mechanic is player-visible.

---

## Cross-cutting notes for the builder agent

- **Two CI gates.** `world/**`-only changes: `cd world && npm run ci`. Items 4 (engine) and any `functions/**` touch: root `npm run ci` too. Never commit generated `index.html`/`game-*.js`.
- **World UI has no DOM test env** (vitest `environment: 'node'`, `world/vitest.config.ts`) — testability comes from extracting pure helpers and testing those; follow the `isTapNotDrag` / `shouldReconnectOnClose` precedent. Don't add jsdom without asking.
- **Protocol changes** (items 1, 7, and item 2's welcome seed) keep client and server in one repo/deploy, but stale clients linger on phones: additive fields only (`spawns?`), never repurpose existing ones.
- **PR bodies are the public changelog** (CLAUDE.md §19 / `pr-changelog` skill): player-facing voice, no internal notes, no attribution/trailers in the body.
- **Manual acceptance** for the visual items (3, 5, 6, 7) should be run on a phone-sized viewport as well as desktop — the HUD width change in item 5 especially.
