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
| Chicken | field_chicken (1) | Matched | First-kill monster for new players |
| Goleling | cave_goblin (5) | Matched | |
| Wizard | arcane_adept (9) / umbral_adept (20) | Matched | One model, two tints |
| Green/Pink/Spiky Blob | bogling_sprite (12) | Candidate | |
| Ghost | wailing_banshee (23) / wraith-type specters | Candidate | |
| Blue Demon | frostbite_imp (25) | Matched | Scale down |
| Orc / Orc Enemy | highland_giant (28) | Candidate | Scale up; or briar_giant (42) green-tinted |
| Frog | marshfen_toad (30) | Matched | |
| Cat | cinderpaw_cub (36) | Candidate | Ember tint |
| Dino | stoneglare_basilisk (62) / embertongue_lizard (68) | Candidate | |
| Goleling Evolved | elder_rock_golem (70) | Matched | |
| Demon | lesser_fiend (82) / pyreclaw_demon (88) | Matched | |
| Yeti | gorroth_the_mountain_ape (650) / hellbound_gorilla (275) | Candidate | Far-future levels |
| **Dragon** | **green_dragon (79) — first world boss** | **Matched** | Dragonfire + `antiDragon` mechanic makes it a real gear-check boss |
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

dustpaw_rat (4) · broodfang_spider (27) — Halloween Bits is graveyard **props only**, no spider · frostmaw_direwolf (85) / wolf-types · stoneback/duneback/tidereaper crabs · elder_tree_spirit / briarheart_treant (treant) · snake/serpent types. None block any planned phase; skip rather than force a bad match.

## Equipment

Policy (decided 2026-07-10): reuse assets maximally — one model per **archetype**, tier conveyed by tint (grey-base + recolour, as the main game's gear pipeline does). Registry maps item id → `{archetype, tint}`; unmapped items render bare-handed and never block.

### Weapons (hand-attached props)

139 weapon-slot items in `items.json` collapse to these archetypes:

| Archetype | Covers (examples) | Asset | Status |
|---|---|---|---|
| Sword | sword, longsword, scimitar, rapier | Quaternius RPG Items `Sword` / `Sword_big`; KayKit `sword_1handed/2handed` | — |
| Dagger | dagger | Quaternius `Dagger`; KayKit `dagger` | — |
| Axe | axe, battleaxe, greataxe | Quaternius `Axe_small` / `Axe_Double`; KayKit `axe_1handed/2handed` | — |
| Blunt | mace, maul, warhammer, flail | Quaternius `Hammer_Double` (2h); no true 1h mace — nearest-model fallback | — |
| Bow | shortbow, longbow | Quaternius `Bow_Wooden`; KayKit `bow_withString` + `quiver` | — |
| Crossbow | crossbow, ballista | KayKit `crossbow_1handed/2handed` | — |
| Staff | staff, battlestaff, elemental staves | KayKit `staff`, Skeletons `Skeleton_Staff` | — |
| Wand | wand | KayKit `wand` | — |
| Whip/claws/spear/exotics | whip, claws, tentacle, spear, lance, harpoon | **No asset** — fallback to nearest archetype (spear→staff silhouette, whip/claws→dagger) until sourced | — |
| Pickaxe (tool) | pickaxes (also the mining-anim prop) | **No asset** | — |

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
