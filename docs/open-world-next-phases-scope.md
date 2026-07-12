# Open-World — Next Phases Scope (Phases 4–8)

> Scoping recommendation written 2026-07-10, after PR #727 merged guide Phases 0–3 (movement, mining + grant flush, cow combat + floor loot, other players + chat, one 32×32 pasture). Covers the six requested workstreams: equipment assets, more monsters, places/environments, inventory reordering, shared-kill loot attribution, and new skills with dedicated areas. Once decisions below are confirmed, each phase gets a step-by-step spec appended to `docs/open-world-build-guide.md` — that guide stays the executable source of truth.

## Recommended sequencing

| Phase | Contents | Size | Why this order |
|---|---|---|---|
| 4 | Shared-kill loot attribution + inventory reordering | S | Server-only + one small UI feature; makes the pasture correctly multiplayer while presence is fresh. No asset work. |
| 5 | Equipment visuals v1 — weapons in hand | M | Highest visible payoff per unit work; independent of zones; proves the attach-to-rig pipeline armour will reuse. |
| 6 | World expansion v1 — zone transitions, prop/scenery layer, forest zone, Woodcutting, 2–3 monsters | M/L | The infrastructure phase everything place-shaped depends on. Woodcutting is a mining reskin, so the new zone ships with gameplay, not as an empty diorama. |
| 7 | Town hub zone (medieval village), Smithing + Cooking processing, 2–3 monsters | M | Consumes Phase 6 infra; closes the mine→smelt→cook loop entirely in-world; the Medieval Village MegaKit exists for exactly this. |
| 8 | Equipment visuals v2 — armour outfits · Fishing + water zone · more monsters | M each | Independent tracks; order by appetite after 7. |

Each phase is one PR, gated the same way as Phases 0–3 (self-verified e2e + DT-class B manual acceptance).

## Phase 4 — Shared-kill loot + inventory reordering

**Loot attribution.** Today `npc.attackerId` is a single slot and loot ownership goes to whoever lands the kill. Change:
- Track `damageByChar` per npc, accumulated from every hit, cleared on respawn and on out-of-combat full heal.
- On death, `ownerCharId` = top contributor (tie → first to reach that total). The existing owner-window/public/despawn pipeline is untouched — only whose name goes on the drop changes.
- **Recommended rule: most damage dealt**, not literal hit count. Damage is fair across weapon speeds and is what the engine already reports per hit; literal hit-count is the same plumbing with a different counter if preferred (see D1).
- Concurrent attackers: each player already runs their own engine session seeded from the npc's shared HP, but every session also processes monster retaliation — with N attackers the monster would swing N times per tick. Fix in the adapter: the npc holds one retaliation target (most recent attacker; falls to next contributor when they leave), and only that player's session processes the monster's attacks.
- XP stays as-is: each player earns 4/dmg + 1.33/dmg HP on their own damage.

**Inventory reordering.** The world pack is server-owned, so reorder is a protocol message, not client state: `{t:'moveInv', from, to}` → server swaps/moves slots → `{e:'inv'}`. Client: drag on desktop, long-press-drag on touch, mirroring the main game's reorder UX (PR #713). v1 is session-local — slot order is not written back to the PocketRPG inventory on flush (the flush moves quantities, not layout; persisting layout touches save-blob semantics for marginal value).

## Phase 5 — Equipment visuals v1: weapons

Goal: your hero (and other players' heroes) holds a weapon matching what the character has equipped in PocketRPG.

- **Mapping policy (recommended): archetype × tier, not per-item.** One model per weapon archetype (sword, axe, mace, dagger, spear, bow, crossbow, staff), tinted per metal/tier — the same grey-base + recolour approach the main game's gear pipeline uses. ~8 processed models cover the whole equipment table; a `world/shared/appearance.ts` registry maps item id → `{archetype, tint}`. Unmapped items render bare-handed, never block.
- **Assets**: Quaternius Ultimate RPG Items (in `assets/open-world/`), processed by a `build-weapon.mjs` sibling of `build-hero.mjs` (strip/shrink, one GLB per archetype). Attached to the hero's right-hand joint — the hero is on the Quaternius universal rig, which these items are built for, so no per-item grip baking is expected (the main game's `canonicalize-weapon` bake targets the other hero rig and is not reused).
- **Protocol**: entity diffs and welcome gain a compact `gear` descriptor (`{weapon?: {archetype, tint}}`), seeded at hello from the save's equipment. v1 appearance is fixed for the session (the world has no equip UI); it refreshes on reconnect.
- Animation note: the hero currently swings `Sword_Attack` for everything; per-archetype attack clips (bow draw, staff cast) are out of scope until ranged/magic combat exists.

## Phase 6 — World expansion v1: transitions, scenery, forest + Woodcutting

The enabler phase. Three pieces of infrastructure, then the first real environment:

1. **Zone registry + transitions.** Zones become a folder of JSONs; each DO instance already keys by room name, so a second zone is `/parties/world-zone/<zoneId>` with no server rearchitecture. Zone JSON gains `exits: [{x, z, toZone, toX, toZ}]`; stepping on an exit tile flushes + checkpoints, then the client reconnects to the target zone's DO at the target tile (`world_positions` already stores `zone_id`). Loading overlay covers the ~1 s handoff.
2. **Scenery layer.** Zone JSON gains `props: [{model, x, z, rot?, scale?}]` — non-interactive dressing (trees, fences, buildings, rocks) rendered from a shared prop catalogue (GLBs processed once from KayKit/Kenney/Quaternius kits, template-cached, instanced where repeated). Collision stays in the ASCII grid; props are visual only, so authoring stays "place a `#`, place a prop on it".
3. **Zone authoring script.** A small generator/validator so 64×64 zones don't mean hand-typing 4,096 characters; the pasture's validator already covers correctness.

**Forest zone + Woodcutting**: normal and oak trees as depleting nodes driven by `skills.json → woodcutting.actions` — the identical interact → ticks → product → deplete → respawn loop as mining, and the hero's `mine` anim is already a tree-chopping clip (rename to a shared `gather`). Logs flow through the existing grant flush untouched. Place 2–3 monsters from the coverage doc's matched list in the forest.

**Geography (recommended): hybrid anchor.** The Phase 7 town is canonically a `world.json` place — Lumbright, the starter town — and resource zones around it (this forest, the existing pasture, a future riverbank) are freeform wilderness. One shared mental model with the idle game, future deep-linking from idle-game travel into world zones, without forcing every zone to match a 14-place gazetteer authored for a menu game (see D2).

## Phase 7 — Town hub + processing skills

- **Lumbright zone (~64×64)**: buildings, walls, market square from the Medieval Village MegaKit + Kenney Fantasy Town Kit via the Phase 6 prop layer. Contains the bank chest, furnace, anvil, cooking range, and zone exits to pasture + forest.
- **Smithing + Cooking**: first *processing* skills — interact with furnace/anvil/range opens a recipe panel (DOM, like the inventory) listing what the pack's contents can make from `skills.json`; server consumes inputs and produces outputs per tick with the idle game's data (smelt tin+copper → bronze bar → smith bronze items; cook raw beef). New mechanics: a recipe-selection message and multi-input consumption from the session pack — both server-side, both unit-testable.
- 2–3 town-appropriate monsters/NPC threats placed outside the walls.

## Phase 8 — Parallel tracks (order by appetite)

- **Armour outfits (equipment v2)**: Modular Fantasy Outfit pieces (same universal rig — mesh swaps, no retargeting) mapped as outfit sets per armour tier with tier tints, riding the Phase 5 `gear` descriptor and registry. Other players' appearance included.
- **Fishing + riverbank zone**: water tiles (visual + blocked), fishing spots as node objects, `fishing.actions` data. Needs one new anim decision (UAL has usable candidates).
- **More monsters**: by Phase 8 the per-monster cost is a model build script run + a zone npc entry + examine text.

## Monsters and equipment — asset coverage

Model↔content matching, per-model status, and gaps live in **`docs/open-world-asset-coverage.md`** (living tracker, updated in the same PR as each shipped asset). Headlines: chicken/goblin/wizard/imp/toad/skeleton all have strong matches for the early waves; dustpaw_rat, spiders, wolves, crabs and treants have **no** asset (Halloween Bits turned out to be graveyard props only) — skip rather than force a bad match. All monsters stay **passive** for now (decided; aggression radius revisited later).

## First boss (decided: yes — one boss; raids deferred entirely)

**green_dragon (level 79)** as the first world boss, in its own lair zone off the wilderness (Phase 8 track): `Dragon.glb` is ready, and dragonfire (33% proc, max 50, blocked by `otherBonus.antiDragon`) already lives in the shared combat engine — making it the world's first genuine gear-check ("bring an anti-dragon shield") and the first fight where the Phase 4 shared-kill damage attribution matters. Drops ride the existing engine loot roll like the bull's. King Black Dragon (`Dragon Evolved`) follows later — as a collection-log boss its kill must emit the same server-side collection-log/kill-count side-effects as `/api/actions/**`, which is exactly the integrity pattern the world server was built for. Raids are out of scope indefinitely.

## Decisions (confirmed by developer, 2026-07-10)

| # | Decision | Outcome |
|---|---|---|
| D1 | Loot rule | **Most damage dealt.** Tie → first to reach the total. |
| D2 | Geography | **Consistent with `world.json` where practical, never a blocker** — when matching a place is awkward, raise it and diverge deliberately. Town hubs canonical (start with Lumbright); wilderness freeform. |
| D3 | Equipment fidelity | **Maximum asset reuse**: archetype × tier tints; coverage tracked per-archetype in `docs/open-world-asset-coverage.md`. |
| D4 | First skills wave | **Woodcutting → Smithing + Cooking → Fishing.** Thieving deferred. |
| D5 | Aggressive monsters | **None yet.** All passive; revisit later. |
| D6 | Phase order | **4 → 5 → 6 → 7 → 8** as tabled above, plus the green_dragon boss on the Phase 8 track. |
