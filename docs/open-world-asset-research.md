# Open-World 3D Asset Research (free packs)

Working shopping list for the open-world companion client. Verified 2026-07-09. Licensing: CC0 preferred; CC-BY acceptable **with the exact attribution recorded here** (game needs a credits mention). Never CC-BY-NC / CC-BY-SA / anything OSRS-derived.

## 1) Executive summary

- **World + monsters + props: KayKit (Kay Lousberg), CC0.** One cohesive low-poly family covering characters, skeletons (first monsters), 200+ dungeon props (chests/crates/torches), medieval buildings, nature, ore-rock resources, and a shared 161-animation library. Five packs (60 MB of GLB/glTF) are already downloaded into `assets/open-world/kaykit/` from the official GitHub mirrors.
- **Modular hero + visible armour: Quaternius Universal ecosystem, CC0** (Universal Base Characters + Modular Character Outfits – Fantasy + Universal Animation Library 1/2). It is the only free family with true mix-and-match armour parts on one shared humanoid rig — exactly what "equipment visible on hero" needs. Manual download required (all Quaternius hosts are proxy-blocked).
- Kenney kits (CC0) are a good environment fallback/expander but overlap with KayKit; treat as tier 2.
- This sandbox's proxy only allows github.com/gitlab/bitbucket — kenney.nl, itch.io, quaternius.com, poly.pizza, opengameart.org, sketchfab all refuse CONNECT (403). Everything not on GitHub is marked MANUAL DOWNLOAD NEEDED with its exact URL.

## 2) Key question: which modular character ecosystem?

| Criterion | KayKit Adventurers (+ Character Animations) | Quaternius Universal (Base Characters + Fantasy Outfits + UAL) |
|---|---|---|
| Base characters | 5 free (Knight, Barbarian, Mage, Rogue, Rogue Hooded); v2.0 adds 3 more in paid EXTRA tier | 6 base bodies (incl. female), game-ready topology |
| Armour modularity | **None on the body** — outfits are baked per character; swapping armour = swapping the whole character mesh. Weapons/shields/helmet-style accessories (25+) bone-attach cleanly | **True modular**: Fantasy outfit kit = 12 outfits split into **62 rigged parts**, mix-and-match on the shared humanoid rig, no per-item fitting |
| Shared skeleton + animations | Yes — Rig_Medium/Rig_Large; separate **KayKit Character Animations** pack: **161 humanoid animations** (idle/walk/combat/tools incl. pickaxing, fishing, digging; skeleton-monster variants), CC0 | Yes — universal humanoid rig; **UAL (100+) + UAL2 (130+)** animations, retarget-tested in Godot/Unity/Unreal, CC0 |
| glTF/GLB | Yes (GLB + glTF/bin, plus FBX) | Yes (glTF + FBX + OBJ) on recent packs; some older packs FBX/OBJ/Blend only |
| Same-family world coverage | **Excellent**: Dungeon Remastered, Medieval Hexagon/Builder, Forest Nature, Resource Bits, Skeletons, Halloween — whole world in one style | Good but looser: Ultimate Monsters (50), animals (cow!), nature, Medieval Village MegaKit — style drifted over the years across packs |
| Availability from this sandbox | **GitHub mirrors — already downloaded** | Manual only (site/itch/poly.pizza all blocked) |
| File sizes (measured/reported) | ~3.6 MB per character GLB (rig+mesh), accessories 10–50 KB each | Not measurable here; low-poly, comparable order |
| Caveat | No body-armour swapping | Newer packs: free tier is "60–70% of the pack"; full content via Patreon source keys — verify free-tier part count after download |

**Recommendation:** two compatible families.
1. **Hero + armour: Quaternius Universal Base Characters + Modular Character Outfits – Fantasy + UAL 1/2.** It is the only free system where armour pieces swap on a shared rig without per-item mesh fitting — the core requirement. Verify the free tier has enough of the 62 parts; if it's too thin, fall back to KayKit Adventurers with accessory-only equipment visuals (weapon/shield/helmet swaps, body armour as class-skin swaps).
2. **Everything else (monsters, dungeon, buildings, nature, props): KayKit.** Style-cohesive, CC0, GLB, and largely already in the repo. KayKit and Quaternius are both flat-shaded gradient-atlas low-poly and mix well in practice.

Note: PocketRPG already owns a Tripo-rigged hero + armour-bake pipeline (§12/§18, `docs/gear-3d-pipeline.md`). If the open world reuses that hero, Quaternius UAL still matters as a CC0 animation source for retargeting, and KayKit covers the rest of the world.

## 3) Catalogue

### Heroes / characters
| Pack | Author | License | Format | Size | URL | Contents | Verdict |
|---|---|---|---|---|---|---|---|
| KayKit Character Pack: Adventurers 1.0 | Kay Lousberg | CC0 | GLB + glTF (FBX deleted) | 18 MB | github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 | 5 rigged/animated chars + 25 weapons/accessories | **DOWNLOADED** → `kaykit/adventurers/` |
| KayKit Adventurers 2.0 (current) | Kay Lousberg | CC0 (free tier) | GLTF/FBX | ~? | https://kaylousberg.itch.io/kaykit-adventurers | v2 rigs compatible with Character Animations; +3 chars (Druid, Engineer, Barbarian XL) in paid EXTRA | MANUAL (upgrade when needed) |
| KayKit Character Animations | Kay Lousberg | CC0 | GLTF/FBX | small | https://kaylousberg.itch.io/kaykit-character-animations | **161 humanoid animations** (Rig_Medium/Rig_Large + skeleton variants; pickaxe/fish/dig/combat) | **MANUAL — high priority** |
| Quaternius Universal Base Characters | Quaternius | CC0 | glTF/FBX/OBJ | ~? | https://quaternius.com/packs/universalbasecharacters.html | 6 base bodies for the modular system | MANUAL — high priority |
| Quaternius Modular Character Outfits – Fantasy | Quaternius | CC0 | glTF/FBX | ~? | https://quaternius.com/packs/modularcharacteroutfitsfantasy.html (also quaternius.itch.io) | 12 outfits / 62 rigged modular parts | **MANUAL — high priority** (verify free-tier part count) |
| Quaternius Universal Animation Library 1+2 | Quaternius | CC0 | glTF/FBX | ~? | https://quaternius.com/packs/universalanimationlibrary.html · .../universalanimationlibrary2.html | 230+ retargetable humanoid animations | MANUAL |
| Kenney Blocky Characters | Kenney | CC0 | GLTF | small | https://kenney.nl/assets/blocky-characters | Blocky style — clashes with KayKit/Quaternius | skip (style) |

### Armour / outfits / weapons
| Pack | Author | License | Format | Size | URL | Contents | Verdict |
|---|---|---|---|---|---|---|---|
| Adventurers accessories (in pack above) | Kay Lousberg | CC0 | glTF | ~1 MB | (downloaded) | swords, axes, daggers, crossbows, staff, shields, quiver, arrows | **DOWNLOADED** → `kaykit/adventurers/Assets/gltf/` |
| Skeletons accessories | Kay Lousberg | CC0 | glTF | ~1 MB | (downloaded) | 13 skeleton weapons/props | **DOWNLOADED** → `kaykit/skeletons/Assets/gltf/` |
| Quaternius Modular Outfits – Fantasy | — | — | — | — | see above | the armour-swap system | MANUAL — high priority |
| Kenney Weapon Pack | Kenney | CC0 | GLTF | small | https://kenney.nl/assets/weapon-pack | extra weapon variety | MANUAL (tier 2) |

### Animals / monsters
| Pack | Author | License | Format | Size | URL | Contents | Verdict |
|---|---|---|---|---|---|---|---|
| KayKit Character Pack: Skeletons 1.0 | Kay Lousberg | CC0 | GLB + glTF | 19 MB | github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 | 4 rigged skeletons (Warrior, Mage, Rogue, Minion) + weapons | **DOWNLOADED** → `kaykit/skeletons/` |
| Quaternius Farm Animal Pack | Quaternius | CC0 | glTF/FBX/OBJ | ~? | https://poly.pizza/bundle/Farm-Animal-Pack-1kUvRTPLzT · https://quaternius.com/packs/farmanimal.html | **the cow**, + pig/sheep/etc., animated | **MANUAL — high priority (cow)** |
| Quaternius Ultimate Animated Animals | Quaternius | CC0 | glTF/FBX | ~? | https://quaternius.com/packs/ultimateanimatedanimals.html | broader animal set | MANUAL |
| Quaternius Ultimate Monsters Pack | Quaternius | CC0 | glTF/FBX/OBJ/Blend | large | https://poly.pizza/bundle/Ultimate-Monsters-Bundle-5oyGWAmOB6 · quaternius.com | **50 animated monsters** (attack/death/run/walk) | **MANUAL — high priority** |

### Nature / trees / rocks
| Pack | Author | License | Format | Size | URL | Contents | Verdict |
|---|---|---|---|---|---|---|---|
| KayKit Medieval Hexagon (nature subset) | Kay Lousberg | CC0 | glTF | in 13 MB | (downloaded) | 42 nature decorations: trees, hills, clouds, rocks | **DOWNLOADED** → `kaykit/medieval-hexagon/Assets/gltf/decoration/nature/` |
| KayKit Forest Nature Pack | Kay Lousberg | CC0 | GLTF/FBX/OBJ | large | https://kaylousberg.itch.io/kaykit-forest | 200+ unique (1500+ with recolours): trees, bushes, rocks, grass, terrain, fences | **MANUAL — high priority** |
| KayKit Resource Bits | Kay Lousberg | CC0 (free 75+) | GLTF/FBX/OBJ | small | https://kaylousberg.itch.io/resource-bits | **ore rocks**, lumber, mining resources | **MANUAL — high priority** |
| Kenney Nature Kit | Kenney | CC0 | GLTF | med | https://kenney.nl/assets/nature-kit (GLB repack: https://eclair-assets.itch.io/nature-kit-glb-pack-329-free-cc0-3d-models) | 330 nature models | MANUAL (tier 2) |
| Quaternius Ultimate Nature Pack | Quaternius | CC0 | FBX/OBJ/Blend (**no glTF**) | med | https://quaternius.itch.io/150-lowpoly-nature-models | 150 models; needs conversion | skip unless converting |

### Buildings / village / castle
| Pack | Author | License | Format | Size | URL | Contents | Verdict |
|---|---|---|---|---|---|---|---|
| KayKit Medieval Hexagon Pack 1.0 | Kay Lousberg | CC0 | glTF | 13 MB | github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0 | 93 buildings (5 colour teams incl. neutral: houses, mills, towers, castles, walls), 26 props, hex terrain tiles | **DOWNLOADED** → `kaykit/medieval-hexagon/` (buildings/props reusable off-hex; tiles are hex, not 32×32-grid friendly) |
| KayKit Medieval Builder Pack (legacy) | Kay Lousberg | CC0 | GLTF/FBX/OBJ | med | https://kaylousberg.itch.io/kaykit-medieval-builder-pack | square-tile medieval buildings, 3 biome variants — better grid fit than hexagon | **MANUAL — high priority** |
| Kenney Fantasy Town Kit | Kenney | CC0 | GLTF (updated 2025, single texture map) | med | https://kenney.nl/assets/fantasy-town-kit | 160 modular town pieces | MANUAL (tier 2) |
| Kenney Castle Kit | Kenney | CC0 | GLTF | med | https://kenney.nl/assets/castle-kit | 75 castle pieces + siege weapons | MANUAL (tier 2) |
| Quaternius Medieval Village MegaKit | Quaternius | CC0 | glTF/FBX | large | https://quaternius.com/packs/medievalvillagemegakit.html (smaller: .../medievalvillage.html, 39 models) | village buildings + props | MANUAL |

### Props / dungeon
| Pack | Author | License | Format | Size | URL | Contents | Verdict |
|---|---|---|---|---|---|---|---|
| KayKit Dungeon Remastered 1.0 | Kay Lousberg | CC0 | GLB | 8.7 MB | github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0 | **203 GLBs**: chests (plain+gold), crates, barrels, coins, keys, torches, walls/floors/doors/stairs, banners | **DOWNLOADED** → `kaykit/dungeon-remastered/` |
| KayKit Halloween Bits 1.0 | Kay Lousberg | CC0 | glTF | 1.3 MB | github.com/KayKit-Game-Assets/KayKit-Halloween-Bits-1.0 | 63 models: graves, tombs, **fences/gates**, spooky trees — graveyard zone | **DOWNLOADED** → `kaykit/halloween-bits/` |
| Kenney Graveyard Kit / Survival Kit | Kenney | CC0 | GLTF | med | https://kenney.nl/assets/graveyard-kit · .../survival-kit | overlap with above | skip / tier 2 |
| Quaternius Ultimate RPG Pack | Quaternius | CC0 | FBX/OBJ/Blend (no glTF) | med | https://quaternius.com/packs/ultimaterpg.html | 100+ RPG props | skip unless converting |

### One-off models (CC-BY now acceptable)
- **Poly Pizza** (https://poly.pizza) — aggregator; Quaternius bundles are CC0, Google Poly–era models are **CC-BY 3.0**. For any CC-BY model record: model name, author, and credit line **"[Model name] by [Author] via Poly Pizza (CC-BY)"** in the game credits. Host proxy-blocked → manual. None adopted yet.
- **OpenGameArt** (https://opengameart.org) — filter license=CC0 (or CC-BY with author credit). Proxy-blocked → manual.
- Avoid Sketchfab "free" without checking per-model license; many are non-commercial.

## 4) Download status

Landed in `assets/open-world/kaykit/` (all CC0, LICENSE.txt included per pack, FBX/import duplicates deleted, ~60 MB total):

| Path | Size | Files |
|---|---|---|
| `adventurers/` | 18 MB | 5 char GLBs (~3.6 MB each) + 25 weapon/accessory glTFs |
| `skeletons/` | 19 MB | 4 char GLBs (~4.6 MB each) + 13 accessories |
| `dungeon-remastered/` | 8.7 MB | 203 GLBs |
| `medieval-hexagon/` | 13 MB | ~220 models (buildings/nature/props/tiles) |
| `halloween-bits/` | 1.3 MB | 63 models |

Method (repeatable for any public GitHub repo despite the proxy): `git clone --depth 1 --filter=blob:none --no-checkout` + sparse-checkout of the `gltf` dirs. Direct HTTPS to codeload/api.github.com archive endpoints is blocked; `git` smart-HTTP and raw.githubusercontent.com work.

**MANUAL DOWNLOAD NEEDED** (host CONNECT 403 via sandbox proxy — download locally, then drop into `assets/open-world/<family>/`):
1. KayKit Character Animations — https://kaylousberg.itch.io/kaykit-character-animations
2. KayKit Forest Nature Pack — https://kaylousberg.itch.io/kaykit-forest
3. KayKit Resource Bits — https://kaylousberg.itch.io/resource-bits
4. KayKit Medieval Builder Pack — https://kaylousberg.itch.io/kaykit-medieval-builder-pack
5. Quaternius Universal Base Characters — https://quaternius.com/packs/universalbasecharacters.html
6. Quaternius Modular Character Outfits – Fantasy — https://quaternius.itch.io/modular-character-outfits-fantasy
7. Quaternius Universal Animation Library 1/2 — https://quaternius.com/packs/universalanimationlibrary.html
8. Quaternius Farm Animal Pack (cow) — https://poly.pizza/bundle/Farm-Animal-Pack-1kUvRTPLzT
9. Quaternius Ultimate Monsters — https://poly.pizza/bundle/Ultimate-Monsters-Bundle-5oyGWAmOB6
10. Kenney Fantasy Town / Nature / Castle Kits — https://kenney.nl/assets/fantasy-town-kit · nature-kit · castle-kit

Blocked hosts observed: kenney.nl, *.itch.io, quaternius.com, poly.pizza, opengameart.org, sketchfab.com, godotengine.org, drive.google.com. Reachable: github.com, gitlab.com, bitbucket.org.

## 5) Gaps (nothing free covers well)

- **Cow / farm animals**: no GitHub-hosted CC0 source found; blocked-host manual download (Quaternius Farm Animal Pack) is the only good option.
- **Square 32×32 ground tiles / terrain**: hexagon pack tiles are hex; free packs assume their own grids. Plan to generate terrain meshes in-engine and use packs only for foliage/props.
- **True modular body armour with generous free tier**: Quaternius Fantasy Outfits free portion unverified (newer packs ship 60–70% free); no other free family does armour-part swapping at all.
- **Fantasy monster breadth on reachable hosts**: only 4 skeletons downloadable now; the 50-monster Quaternius pack is manual.
- **NPC villagers/shopkeepers**: reuse Adventurers/Quaternius base characters with outfit variants; no dedicated free villager pack in this style.
