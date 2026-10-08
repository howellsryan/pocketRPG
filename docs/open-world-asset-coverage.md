# Open-World Asset Coverage — Monsters & Equipment

> Living tracker: which game content has a 3D asset in `assets/open-world/`, and whether it has been brought into the open-world client yet. Update the Status column in the same PR that ships the asset. Written 2026-07-10.
>
> Status values: **In world** (shipped, model in `world/client/public/models/`) · **Matched** (asset identified, not built) · **Candidate** (plausible with tint/scale, judgement call at build time) · —.
>
> Licensing reminder (guide §2.1): KayKit/Kenney are CC0; Quaternius `[Standard]` packs are paid-license — use in-game freely, never redistribute raw files, always strip/shrink textures before committing a processed model.

## Monsters

Model-first: every usable creature model we own, its best `monsters.json` match, and status. The combat adapter is monster-agnostic, so bringing a matched monster in costs one `build-<name>.mjs` script run + a zone npc entry + an examine string.

### Quaternius Ultimate Monsters Bundle (45 rigged GLBs)

| Model | Match in `monsters.json` (level) | Status | Notes |
|---|---|---|---|
| Chicken | field_chicken (1) | **In world** (Phase 6) | `build-monster.mjs`; the Whisperwood |
| Goleling | — | Rejected for cave_goblin | Floating creature does not match the idle goblin identity; cave_goblin now uses the procedural moss-green humanoid with walking and combat poses |
| Wizard | arcane_adept (9) / umbral_adept (20) | **In world** (Phase 6, arcane_adept) | Living-hat creature; umbral tint still pending |
| Green/Pink/Spiky Blob | bogling_sprite (12) | **In world** (Phase 7, Green Blob) | Outside Lumbright's walls |
| Ghost | wailing_banshee (23) / wraith-type specters | Candidate | |
| Blue Demon | frostbite_imp (25) | **In world** (Phase 7) | Scaled down; outside Lumbright's walls |
| Orc / Orc Enemy | highland_giant (28) | Candidate | Scale up; or briar_giant (42) green-tinted |
| Frog | marshfen_toad (30) | **In world** (Phase 7) | Outside Lumbright's walls |
| Cat | cinderpaw_cub (36) | Candidate | Ember tint |
| Dino | stoneglare_basilisk (62) / embertongue_lizard (68) | Candidate | |
| Goleling Evolved | elder_rock_golem (70) | Matched | |
| Demon | lesser_fiend (82) / pyreclaw_demon (88) | Matched | |
| Yeti | gorroth_the_mountain_ape (650) / hellbound_gorilla (275) | Candidate | Far-future levels |
| **Dragon** | **green_dragon (79), red_dragon, black_dragon** | **In world** | Shared dragon mesh with distinct tints and bounded presentation scale; ordinary dragon encounters retain their existing combat mechanics and 3 × 3 bodies |
| Dragon Evolved | king_black_dragon (276) | Matched | Later; KBD is a collection-log boss — kill must emit the same server-side log/KC side-effects as `/api/actions/**` |
| Squidle | deepmaw_kraken (291) | Matched | Needs a water zone first |
| Mushroom King | — | — | No mushroom monster exists; strong candidate model if we ever author one (`add-content`) |
| Alien, Alpaking (+E), Armabee (+E), Cactoro, Glub (+E), Hywirl, Monkroose, Mushnub (+E), Ninja, Tribal | — | — | No sensible match; available for future content |
| Bunny, Birb, Pigeon | — (ambient) | Matched | Non-combat town/field critters for zone life |
| Fish | — (scenery) | Matched | Fishing-spot visuals when Fishing ships |

### Quaternius Farm Animal Pack (7 rigged GLBs)

| Model | Match (level) | Status | Notes |
|---|---|---|---|
| Cow | pasture_bull (8) | **In world** | `build-cow.mjs`; the Phase 2 monster |
| Chicken | — | — | Use the Monsters Bundle chicken (rigged consistently with it) |
| Sheep, Pig, Horse, Llama, Pug, Zebra | — (ambient) | Matched | Farm/town ambience; sheep also future Crafting (shearing) content |

### KayKit Skeletons (4 rigged characters + weapon props)

| Model | Match (level) | Status | Notes |
|---|---|---|---|
| Skeleton_Warrior | glaive_skeleton (45) | Matched | |
| Skeleton_Mage | bonelight_pyromancer (99) | Candidate | |
| Skeleton_Minion / Skeleton_Rogue | boneclaw_revenant (98) / gravehusk_brute (82) | Candidate | |

### Known gaps (no asset — DT-class C if wanted)

dustpaw_rat (4) now uses a reviewed procedural rat. cave_goblin (5) now uses a reviewed procedural humanoid; the former floating Goleling substitution was removed. Remaining gaps include broodfang_spider (27) — Halloween Bits is graveyard **props only**, no spider · frostmaw_direwolf (85) / wolf-types · stoneback/duneback/tidereaper crabs · elder_tree_spirit / briarheart_treant (treant) · snake/serpent types. Missing species block their corresponding canonical world activities; record those bindings as deferred instead of forcing a mismatched model.

## Equipment

Policy (decided 2026-07-10): reuse assets maximally — one model per **archetype**, tier conveyed by tint (grey-base + recolour, as the main game's gear pipeline does). Registry maps item id → `{archetype, tint}`; unmapped items render bare-handed and never block.

### Weapons (hand-attached props)

139 weapon-slot items in `items.json` collapse to these archetypes:

| Archetype | Covers (examples) | Asset | Status |
|---|---|---|---|
| Sword (1h + 2h) | sword, longsword, rapier, godswords | KayKit `sword_1handed/2handed` | **In world** (Phase 5) |
| Dagger (curved blade) | dagger, **scimitar** (developer decision 2026-07-10: scimitars share this asset, tier-tinted), claws | KayKit `dagger` | **In world** (Phase 5) |
| Axe (1h + 2h) | axe, pickaxe, battleaxe, greataxe, scythe | KayKit `axe_1handed/2handed` | **In world** (Phase 5) |
| Blunt | mace, maul, warhammer, flail | Quaternius `Hammer_Double` (obj2gltf) | **In world** (Phase 5) |
| Bow | shortbow, longbow | KayKit `bow_withString` | **In world** (Phase 5; grip pending visual tune) |
| Crossbow | crossbow, ballista, blowpipe | KayKit `crossbow_2handed` | **In world** (Phase 5; grip pending visual tune) |
| Staff | staff, battlestaff, elemental staves, spear/lance/harpoon silhouette | KayKit `staff` | **In world** (Phase 5) |
| Wand | wand | KayKit `wand` | **In world** (Phase 5) |
| Whip/claws/tentacle | exotics | **No bespoke asset** — render as dagger silhouette | In world via fallback |
| Spear (true model) | spear, lance, harpoon | **No asset** — rendered as staff pole for now | In world via fallback |

Registry: `world/shared/appearance.ts` (item id → archetype + tier tint); models built by `world/scripts/build-weapons.mjs`. Note: hand-held props came from KayKit rather than the vendor-steering Quaternius default — they only parent to a joint, no rig sharing, and KayKit ships ready-to-use glTF where Quaternius RPG Items is OBJ/FBX (accepted deviation, recorded in the guide §11).

Vendor-steering note: guide §2.1 routes rig-attached visuals to Quaternius, but hand-held props only parent to a joint — KayKit weapons work fine there. Recorded as an accepted deviation for the gap archetypes (staff, wand, crossbow, dagger alt, shields).

### Shields

| Covers | Asset | Status |
|---|---|---|
| All 26 shield-slot items (tier tints; bulwark included) | KayKit `shield_round/square/badge/spikes` (+ Skeletons variants) | — |

### Armour (rig-fitted outfit pieces — Quaternius only, per vendor steering)

The Modular Fantasy Outfits pack ships **two** outfit sets (Ranger, Peasant) × male/female on the hero's universal rig, split into Body/Arms/Legs/Feet/Head/Pauldron parts, with per-set textures. So v1 armour visuals = silhouette per broad class + tier tint, not per-tier silhouettes:

| Slot(s) | v1 visual | Asset | Status |
|---|---|---|---|
| body/legs/gloves/boots (melee tiers) | Peasant set (bare) → Ranger set (equipped) + metal-tier tints | `Modular Parts/*` | — (hero currently hard-wears Male_Ranger) |
| head | Ranger hood + tier tint; no helmet mesh exists | `*_Head_Hood` | — |
| cape | **No asset** — defer | — | — |
| neck/ring/ammo | Too small to read at world camera distance — never render | n/a | n/a |

Helmets, distinct armour silhouettes per tier, and capes are the weakest coverage area; more Quaternius outfit/armour packs are the likely future DT-class C ask.

### NPC / scenery humanoids

KayKit Adventurers (Knight, Barbarian, Ranger, Rogue, Mage on Rig_Medium + full Character Animations library) are reserved for standalone town NPCs (shopkeeper, banker, quest-givers) — they can't share the hero's rig but never need to.
