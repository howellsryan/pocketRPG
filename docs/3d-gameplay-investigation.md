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
