# 3D Assets & Gameplay — Investigation

> Status: investigation / decision-support. No engine or build changes yet. Goal: decide *how* PocketRPG could adopt 3D (e.g. Tripo3D-generated models) to make some surfaces — combat first — more elaborate, without breaking the constraints that make the game work.

## 1) What we have today (the baseline the 3D has to respect)

- **Visuals are 100% vector + emoji.** Every monster, item, and skill renders as a masked-gradient [game-icons.net](https://game-icons.net) glyph (`GameIcon`/`SkillEmblem`) resolved in `src/utils/combatArt.js` (`MONSTER_ART`, `CATEGORY_ART`, `RAID_ART`). No sprites, no animation, no raster monster art. Combat feedback = text damage splats + toasts.
- **The only raster assets shipped** are the landing screenshots (`public/landing/*.webp`, base64-inlined by `build_single.cjs`) and the logo. That is the precedent for "real images in the bundle."
- **Build is a single self-contained file.** `index.html` (inline core) + one content-hashed `game-<hash>.js` chunk, both **classic (non-module) scripts** sharing one global lexical scope (§12 of CLAUDE.md). No `import` at runtime; everything is concatenated. The chunk already carries ~126 KiB of `gameIconsData` + ~920 KiB `bespokeIcons.json`.
- **Deterministic, tick-based core (600ms), idle-first.** `src/engine/**` is pure logic with **no UI imports**. The game runs 24/7, catches up offline, and targets low-end mobile. Any presentational layer must stay strictly outside the engine.
- **CSP/headers**: `_headers` sets `Cross-Origin-Embedder-Policy: require-corp` + `Cross-Origin-Resource-Policy: cross-origin`. Same-origin assets are fine; any *externally hosted* model (e.g. a CDN) must send CORP headers or it will be blocked.

**Takeaway:** the codebase is already cleanly separated (engine vs. UI), so 3D is a *rendering* concern only. The real constraints are **bundle size, mobile GPU/battery budget, and the classic-script build model** — not architecture.

## 2) What Tripo3D actually gives us

Tripo3D is text/image→3D generation. Output is **GLB/GLTF** (also OBJ/FBX/USDZ) with PBR textures, optionally **rigged + animated** (walk/attack/idle). Practical realities:

- A single textured GLB is typically **1–10 MB**. With 107 monsters + bosses + items, shipping raw GLB for everything is a non-starter for a bundle that currently prides itself on Lighthouse scores.
- Generated meshes are often high-poly and non-game-optimised; they usually need **decimation + texture downscale + Draco/meshopt compression** before use.
- Licensing/attribution and determinism of generation need a pinned, versioned asset pipeline (generate once, commit the *processed* asset, never generate at runtime).

## 3) Integration options (ranked for THIS codebase)

### Option C — Pre-rendered from 3D (RECOMMENDED first step)
Use Tripo3D models **offline only**. Render each model to **turntable frames / a short looping WebP or a sprite sheet** (idle bob + attack + hit + death), then ship those as raster assets exactly like the landing WebPs.

- **Runtime cost: ~zero.** No WebGL, no new JS dependency, no battery hit. Works on the weakest phone and while backgrounded.
- **Fits the existing pipeline** (`build_single.cjs` already inlines/serves WebP) and the existing art-resolution seam: `combatArt.js` maps `monsterId → { icon, accent }`; add an optional `sprite` key and let `SkillEmblem` fall back to the glyph when absent. Progressive, per-monster rollout.
- **Cost is authoring time + bytes**, not architecture. Budget e.g. a 256×256 looping WebP per monster (~30–120 KB); lazy-load per encounter rather than inlining all 107.
- Downsides: not truly interactive 3D; fixed camera; re-render to change a pose.

### Option A — `<model-viewer>` for a live "inspect" view (good Phase 2)
Google's `<model-viewer>` web component displays a GLB with orbit controls out of the box (~1 MB, self-contained).

- Great for **hero moments**: a boss-reveal card, a "Bestiary/inspect" screen, a collection-log 3D trophy — where the player *chooses* to look and one model is on screen.
- **Build friction:** it's an ES module / custom element, hostile to our classic-script concat. Load it **lazily and out-of-band** (own `<script type="module">` injected only when the inspect view opens), never in the core or the concatenated chunk. Same-origin host the GLB or set CORP headers (COEP is `require-corp`).
- Not the tool for scripted, engine-synced combat animation.

### Option B — three.js directly (only if combat becomes genuinely real-time 3D)
Full control: `AnimationMixer` to drive idle/attack/hit/death clips synced to the 600ms tick, one shared renderer, instancing.

- Powerful but **heavy** (~150 KB gz core + loaders) and **complex**; it fights the classic-script build and the idle/mobile/battery posture. A persistent WebGL context in a 24/7 idle game is a battery and thermal liability.
- Only justified if we commit to combat being a *watchable animated scene*, not a menu with better art. Treat as a later, opt-in ("high fidelity") mode behind a device/perf gate, lazy-loaded, torn down when combat closes.

### Option D — Hybrid (the actual roadmap)
Pre-rendered sprites everywhere by default (Option C) **+** an opt-in live 3D inspect/boss view (Option A), with Option B reserved for a future "cinematic combat" experiment. Default experience stays cheap; fidelity is opt-in and device-gated.

## 4) Recommendation

**Phase 0 — Pilot (small, reversible).** Take the two Tripo3D models already generated, process them (decimate + downscale + compress), render each to a looping WebP + a couple of pose frames, and wire them into **one boss or one starter monster** via a new optional `sprite` field in `combatArt.js`, lazy-loaded in `CombatScreen`. Proves the pipeline end-to-end and lets us feel it on a phone before committing to 107 assets.

**Phase 1 — Bestiary / boss-reveal inspect view (Option A).** Add a lazily-loaded `<model-viewer>` inspect surface (long-press a monster, or a boss-reveal card, or a collection-log trophy). One model on screen, user-initiated — the safe place for real 3D.

**Phase 2 — Broaden sprite coverage.** Roll pre-rendered art across areas/bosses as assets are produced; keep the glyph fallback so partial coverage always renders.

**Phase 3 (speculative) — Cinematic combat (Option B).** Only if Phases 0–1 show players want to *watch* fights. Behind a perf/device gate, torn down aggressively, never running while idle/backgrounded.

## 5) The asset pipeline (generate-once, commit-processed)

1. **Generate** in Tripo3D (text/image → GLB), pin the model + prompt/seed for reproducibility.
2. **Optimise** offline: decimate polys, downscale textures (e.g. ≤1K), Draco/meshopt compress. Target GLB well under ~1 MB if kept as 3D.
3. **Bake** (Option C): headless render (Blender/three.js) → looping WebP + pose frames at the UI's actual display size (128–256 px).
4. **Commit the processed output only** under `public/` (raster) or a versioned model dir — never raw generator output, never generate at runtime.
5. **Wire** via `combatArt.js` (`sprite`/`model` keys) so the glyph system stays the universal fallback.
6. Add a `scripts/` step to (re)bake assets, and a regression test that every referenced sprite/model file exists (mirrors the collection-log slot test discipline).

## 6) Hard constraints / non-negotiables

- **Never touch the deterministic engine** — 3D is presentation only. No 3D lib import inside `src/engine/**`.
- **Never inline all models/sprites into the core or the concat chunk** — lazy-load per encounter/inspect. Keep Lighthouse and cold-start intact (`docs/lighthouse-performance-optimization.md`).
- **Nothing WebGL runs while idle/offline/backgrounded** — the idle loop is the product; a background GPU context is unacceptable.
- **Glyph/emoji fallback stays** for every monster so partial 3D coverage never leaves a blank.
- **Same-origin (or CORP-headed) assets only** — COEP is `require-corp`.
- **Licensing** for generated assets confirmed before shipping.

## 7) Open questions for product

1. Is the near-term goal **prettier static combat art** (→ Option C) or **watchable animated fights** (→ Option B)? These are very different investments.
2. Priority surface: combat monsters, boss reveals, collection-log trophies, or item inspection?
3. Acceptable bundle/download budget on mobile for the 3D tier?
4. Do we want a device-gated "high fidelity" toggle, or one experience for everyone?

## 8) Suggested first commit (if greenlit)

Phase 0 pilot only: process the two existing Tripo3D models → looping WebP, add an optional `sprite` field to `combatArt.js` + a `MonsterSprite` component that renders the WebP and falls back to `SkillEmblem`, lazy-loaded on one monster in `CombatScreen`. Small, self-contained, reversible — a real thing to feel on a phone.

## 9) Update — measured pipeline + agreed plan

Real Tripo3D assets (warrior, red dragon, crimson dagger, map) were profiled and run through an offline pipeline (`scripts/process-3d-model.mjs`: dedup → weld → meshopt `simplify` → WebP textures → meshopt compression).

**Findings:** all four are **single fused static meshes** — no rig, no skeleton, no animations — at 43–55 MB and 1.3–1.9M tris. Unshippable raw. After processing:

| Asset | Raw | Processed | Tris |
|---|---|---|---|
| Warrior | 43.3 MB | **0.86 MB** | 38k |
| Red dragon | 54.7 MB | **1.16 MB** | 57k |
| Crimson dagger | 13.0 MB | **0.78 MB** | 24k |
| Map | 1.8 MB | 0.35 MB | 15k |

A warrior + weapon + dragon scene ≈ **2.8 MB / ~120k tris** — phone-shippable, lazy-loaded, torn down on screen close. `simplify` preserves skin weights, so a rigged input stays rigged.

**Two consequences of "fused static mesh":** (1) animation needs a **rig** we don't have — source it from Tripo's rig/animate re-export; (2) you can't swap gear on a mesh with gear baked in — equipping needs a **base-body warrior (empty hand)** plus **separate per-item models** attached to bones.

**Agreed build plan:**
- **Phase 1 — Equip screen (mobile + desktop), replaces the paper doll.** Rigged base-body warrior (from Tripo re-export) in a lazily-loaded three.js viewer; **weapon-only** equipment for now (weapon model attaches to the hand bone; other slots keep the icon UI) but the slot registry is **architected for full layering** next. three.js loaded on demand (not in the concat chunk), torn down on unmount, never running while idle. Paper doll stays as the guaranteed fallback (no WebGL / reduced-data / unsupported).
- **Phase 2 — Combat vs red dragon (one monster).** Warrior (rigged attack/idle) vs a **transform-faked** dragon (whole-mesh lunge/recoil/shake — no rig needed first pass). Perf/device-gated, torn down when combat closes.

**Needed from product:** rigged + animated **base-body warrior** (empty hand, idle + attack, low poly) re-exported from Tripo; the dragon can stay static (transform-faked).

### Landed so far (Phase 1 groundwork)
- **Vendored three.js** at `public/vendor/three/` (core + `GLTFLoader` + `meshopt_decoder` + `OrbitControls` + `SkeletonUtils`), imports rewritten to **relative paths** so it resolves in both Vite dev (`/…`) and the deployed single-file build (`/public/…`) with **no import map**. Served as static files — not inlined into the core/concat chunk.
- **On-device preview + weapon aligner** at `public/3d-preview.html` (standalone, not in the app bundle). Loads a character + weapon GLB, attaches the weapon to a chosen bone with live position/rotation/scale sliders, and emits the exact transform to paste into the registry. Also previews the transform-fake attack lunge. Open at `/3d-preview.html` (dev) or `/public/3d-preview.html` (prod). Sample processed GLBs in `public/3d-samples/` (throwaway placeholders — swap in the rigged warrior).
- **Equipment model registry** `src/data/equipmentModels.json` + resolver `src/utils/equipModels.js` (+ test): maps an equipped item → optional model + placement transform; weapon-only entries now, `bone`-per-entry schema already shaped for full-slot layering. Returns null → icon-UI fallback, so 3D coverage is always partial-safe.

### In-app viewer — landed
`Model3DViewer` (`src/components/Model3DViewer.jsx`) + lazy loader (`src/utils/three3d.js`) are wired into `EquipmentScreen` for both layouts: when WebGL is available it renders the 3D hero as the centerpiece with the equipped weapon attached via the registry, and keeps a compact slot grid beneath for equip/unequip; otherwise it falls back to the paper doll (zero regression). three.js dynamic-imports on mount and fully tears down on unmount (RAF cancelled, GL context released, geometries/materials disposed) — nothing runs while idle. Registered in `build_single.cjs` (`sourceFiles` + `GAME_CHUNK_FILES`); `equipmentModelsData` + `pocketAssetBase='/public/'` injected into the chunk; `/public/vendor/*` + `/public/3d-samples/*` cache-headers added. Commit gate green (2097 tests + build + rebuild + check:single).

The current hero is the **static placeholder** warrior — it renders and rotates, and the Dragon Dagger's 3D model attaches at the model root (no rig yet). Dropping in the **rigged base-body warrior** unlocks the hand bone + idle/attack clips; set its hand-bone name as `defaults.handBone` in `equipmentModels.json` and tune each weapon's offset with the preview aligner.

### Update — vendor fix, real hero, minified three
- **Root-cause fix:** the hand-vendored `three.module.js` imported `./three.core.js` which was never committed — the vendored ES-module graph had **never loaded** in a deployed build (viewer silently fell back to the paper doll). Vendoring is now generated from the pinned `three` devDependency via `npm run sync:three`, guarded by `tests/threeVendor.test.ts` (entry files exist, every import resolves, no drift from npm), and verified headless in Chromium.
- Vendor now ships the **minified** builds (`three.module.min.js` + `three.core.min.js`, ~55% smaller pre-compression); addons stay unminified upstream and are small.
- The equip-screen hero is **PocketRPGHerov3** (`public/3d-samples/hero.glb`, 4.7 MB → 0.62 MB, 4.6k tris): rigged (41 joints incl. `L/R_Hand`) with **clean skin weights** and three baked clips, renamed in the GLB by the pipeline follow-up to **`Idle`** (15.4s, looped in the equip screen via `character.idleClip`), **`Box`** (2.2s — the attack candidate for Phase 2 combat), and **`Run`** (1.3s). The Dragon Dagger attaches to `R_Hand` in a reverse grip and rides the hand through the idle sway.

### Asset lessons (from the two rejected hero exports)
- A Tripo **statue export is T-posed** unless generated in a pose — check before assuming it can centerpiece a screen.
- A Tripo **rig-only export can have broken accessory weights**: on the v2 hero, any bone rotation (even 18°) shredded the bra/bracers/back-staff into stretched shards while body skin deformed fine (verified on the raw export — not our pipeline; `simplify` preserves weights). Clips retargeted onto such a rig shred identically. **Rule: always check Tripo's animated preview before downloading**, and avoid baked-on back weapons — they weight terribly.
- Clip names arrive as Blender NLA junk (`NlaTrack.001`…) — rename to semantic names (gltf-transform `anim.setName`) when processing; the registry/viewer reference clips by name.
- Viewer pauses its render loop on `visibilitychange` and reports failure to the parent (`onFail`) so `EquipmentScreen` swaps back to the full paper-doll layout instead of an empty card.

## 10) R2 asset hosting (planned migration)

Committed GLBs don't scale (107 monsters × ~1 MB bloats every clone forever). Models move to the **`pocketrpg-tripo-assets`** R2 bucket; the client is already R2-ready:

- `equipmentModels.json` `modelBase` (or any single entry's `model`) may be a **full URL** — `equipModels.js` skips prefix-joining for absolute values and `three3d.js#assetUrl` passes them through. Pointing `modelBase` at the bucket is the entire client change.
- **Serving**: bind the bucket to a custom domain (e.g. `assets.pocketrpg.co.uk`) rather than the `r2.dev` public URL — r2.dev is rate-limited, uncacheable-by-rule, and not meant for production.
- **CORS is required** (GLTFLoader fetches cross-origin): allow `GET`/`HEAD` from `https://pocketrpg.co.uk` and preview origins (`https://*.pocketrpg.pages.dev`) in the bucket's CORS policy. No CORP/COEP concerns — the app no longer sends COEP.
- **Naming**: upload content-suffixed names (`hero.v2.glb`), never overwrite — then edge caching can be immutable and a registry bump is the atomic "deploy".
- `scripts/upload-model-r2.sh <raw.glb> <name.glb> [flags]` runs the offline pipeline and `wrangler r2 object put`s the result under `models/`.
