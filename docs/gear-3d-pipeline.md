# 3D armour (gear) pipeline

How an armour piece goes from an authored GLB to an equippable 3D model on
the hero. Weapons have their own flow (`canonicalize-weapon.mjs`); animations
have `docs/hero-animation-retarget-guide.md`.

## Authoring spec (what to generate in Tripo)

- **Smart mesh / low-poly output** (a few thousand tris), standard texture —
  `process-3d-model.mjs` shrinks textures to 512px, so HD adds nothing.
- **Worn shape**, upright, facing +x, no body/mannequin inside the shell.
- **Neutral grey steel** base colour: `recolor-model.mjs --grey` then derives
  every metal tier (bronze → runeforged + dragon) from the one authored model,
  so a full tier line costs one textured generation.

## Head slot (live)

```bash
node scripts/fit-headgear.mjs raw.glb fitted.glb          # snug-fit bake (canonical head space)
node scripts/process-3d-model.mjs fitted.glb helm.glb --ratio 1.0 --tex 512
cp helm.glb public/3d-samples/<name>.glb                  # or: wrangler r2 object put pocketrpg-assets/models/<name>.v1.glb --file helm.glb
node scripts/recolor-model.mjs helm.glb <tier>.glb --grey 0.35 --to <hue> --sat <s> --light <l>  # per tier, params in scripts/model-variants.json
```

Then register each item in `src/data/equipmentModels.json` under `gear` —
`{ "model": "<file>", "slot": "head", "hideHead": true }` is the whole entry;
the shared `defaults.gear.head` transform (bone `Head`, measured from the
hero's skull vertices) places every canonically-fitted piece.
`tests/equipModels.test.ts` enforces registry ↔ items.json ↔ file-on-disk
consistency.

Fit notes — two regimes, pick per shape:

- **Fully-enclosing helms** (full helm, great helm, closed bascinet): use the
  fit tool's defaults (knight-snug, sized to the skull) **and set
  `"hideHead": true`** on the registry entry. The hero's hairstyle is far
  bigger than the skull and can't be hidden by geometry (single-mesh Tripo
  rig, no separable hair mesh), so the head is hidden with a **per-vertex
  shader mask** rather than a bone transform. `setupHideMask()` in
  `Model3DViewer.jsx` computes, once per hero load, each vertex's total skin
  weight on the Head bone and stores it as a `headMask` attribute; a patched
  material (`onBeforeCompile`) discards any fragment whose interpolated mask
  says it's dominantly part of that bone's region. `attachGearList` flips the
  mask on/off (`st.headMaskCtl.setHidden(...)`) based on whether any equipped
  piece has `hideHead: true`. This is exact in every pose — it never touches
  the skeleton, so the neck geometry is never distorted and there's no
  per-frame drift to chase. An earlier bone-scale-and-reposition approach was
  tried and discarded: Head and Neck share skin weights at the collar, so
  scaling the bone always left some pinch, and it was only ever
  *approximately* right in extreme poses (death, hit reactions) since the
  hidden bone's position had to be re-derived every frame from the
  currently-animated rotation.
- **Open headwear** (hats, hoods, circlets — head stays visible): no
  `hideHead`; the piece must contain the hair, so bake with hair-sized
  margins, e.g. `--margins 1.25,1.12,1.06 --shift 0.06 --lift 0`.

Verify with a render before committing — clip-through and neck artifacts show
up most in the `hit_head` and `sword_attack` clips.

## Multi-part uploads (one GLB, several pieces)

Some generations batch several items into one file for efficiency (e.g. a
torso + two legs + a pauldron all in one mesh, worn together on a preview
mannequin). `scripts/split-gear-glb.mjs` pulls them apart:

```bash
node scripts/split-gear-glb.mjs raw.glb --list                 # rank every welded island by vertex count + Y-range
node scripts/split-gear-glb.mjs raw.glb \
  --extract platebody.raw.glb=0:clip=0.10,10 \                 # island 0, only y in [0.10, +inf) — trims an integrated skirt/legs off a torso
  --extract platelegs.raw.glb=1,2                               # islands 1+2 merged into one file (e.g. matched L/R legs)
```

Tripo output is rarely welded at panel seams, so a naive shared-index
connected-components pass over-fragments into hundreds of micro-islands
(rivets, straps, each unwelded plate) — the tool first welds vertices that
are merely close in space (`--eps`, default 0.0015) before flood-filling, so
`--list` shows the real pieces. Two pieces that visually touch in the source
scene (a coat whose hem overlaps its own built-in skirt) still weld into one
island; there's no seam to split on then, so pick a Y-band with `:clip=` after
eyeballing the `--list` Y-ranges (or rendering a couple of candidate cuts —
see the render-and-iterate pattern used throughout this doc). Extracted files
are raw — run `process-3d-model.mjs` (and `fit-headgear.mjs` /
`canonicalize-weapon.mjs`, if the slot needs it) on each afterwards, same as
any authored asset.

## Body / legs / boots / gloves / cape slots (skinned; fit is manual)

Unlike the helmet, these pieces can't ride one bone — they have to bend at
the shoulder, hip, knee, ankle or spine along with the body, so each needs
to be a **skinned mesh sharing the hero's own skeleton**, not a rigid
bone-attach.

**The fit is a one-time manual Blender step per base asset** (~10–15 min):
import `public/3d-samples/hero.glb`, arrange the piece on the body, export
the piece alone — full walkthrough in `docs/gear-asset-process.md`. This is
a deliberate design decision, not a gap. Automatic fitting was attempted
three ways and each failed structurally:

- *uniform height-match scaling* keeps the source mannequin's proportions —
  the platelegs came out ~3x wider-stanced than the hero's legs and the
  platebody stuck ~2/3 of a body depth out of the hero's back. The
  transferred weights were CORRECT, so the suit deformed plausibly while
  hovering beside/behind the hero; every per-vertex diagnostic (posed drift
  vs nearest hero skin vertex) looked healthy while the render was obviously
  wrong. If a piece "deforms right but floats", suspect the geometry's
  bind-pose placement, not the weights.
- *per-vertex shrinkwrap* (nearest-surface projection + clamped clearance +
  smoothed displacement field) shatters plates — neighbouring vertices
  project onto different hero regions and the field tears coherent panels.
- *per-bone affine blends* (cluster centroid translate + radial girth scale,
  blended by skin weights) keep panels coherent but crumple the authored
  silhouette and still read as a bad fit.

A human eye + Blender does in minutes what those can't; everything on either
side of the fit is scripted:

```bash
node scripts/canonicalize-armour.mjs <item>.fitted.glb <item>.raw.glb --slot body   # legs|boots|gloves|cape
node scripts/process-3d-model.mjs <item>.raw.glb <item>.glb --ratio 1.0 --tex 512
```

`canonicalize-armour.mjs` (against `public/3d-samples/hero.glb` as the fixed
reference — re-run if the hero model or rig ever changes):

1. **Fit sanity check** — refuses input whose vertices don't hug the hero's
   surface for the slot (p90 distance > 0.15 hero units ≈ 13cm), the usual
   symptom of exporting in the wrong space or skipping the fit step.
2. **Strip mannequin skin** — generated suits are made worn, and split
   pieces routinely keep welded scraps of the mannequin (a neck stub in a
   chest piece, bare toes poking out of sabatons). They're skin-coloured
   texels on the armour's own atlas, so each triangle is sampled at 7 UV
   points (corners, edge midpoints, centroid) and dropped when most read as
   flesh tones; `--keep-skin` disables it. A corners-only test was tried
   first and kept every boundary triangle where skin meets armour texels.
3. **Weight transfer** — each vertex binds to its k nearest hero *surface*
   vertices (inverse-distance blend), with the candidate pool pre-filtered
   to hero vertices dominantly weighted to the slot's bone chain, grouped
   L/R/C by bone-name prefix so a left plate only searches left-side
   (+centre) candidates. Two cheaper approaches were tried and discarded:
   an unrestricted nearest-vertex search happily matches a chest-plate hem
   to the nearest THIGH skin vertex, and the plate tears the moment legs
   and torso move independently; collapsing each candidate bone to a single
   centroid point stops that but loses the real shape of each bone's
   region, so a broad bone (Waist) "wins" nearest-point for a wide swath of
   vertices that are visually much closer to a neighbouring bone (Spine02).
   Restricting candidate *vertices*, not bones, keeps the real per-point
   surface detail while still ruling out anatomically unrelated matches.
   The output mesh is built inside hero.glb's OWN document sharing its OWN
   skin/joint hierarchy, so joint indices are correct by construction.

Register with `{ "model": "<file>", "slot": "body", "hideBody": true }`
(legs → `hideLegs`) — no transform fields at all; the fit is baked into the
mesh, and `attachGearList` detects a skinned piece (its geometry carries
JOINTS_0/WEIGHTS_0) automatically and rebinds it, rather than parenting it
to a bone like the rigid slots. `tests/equipModels.test.ts` asserts every
body/legs model actually has a skin with all 41 joints, so an asset that's
accidentally exported static fails CI instead of silently rigid-attaching.

**Hide masks**: even a well-fitted plate clips in extreme poses (a ~1k-tri
plate triangle chords across a curved 7k-tri thigh), so covering pieces set
`hideBody`/`hideLegs`: the same per-vertex shader mask that hides the head
under a full helm (`setupHideMask` in `Model3DViewer.jsx`, a vec3 of
head/torso/legs region weights with per-channel thresholds) discards the
hero's covered anatomy, so skin can never bulge through in any pose while
bare arms/neck/hips still show around the piece's edges. Boots/gloves/cape
have no mask region yet — the first such asset adds its bone list to
`HIDE_REGION_BONES`.

The output mesh is built inside `hero.glb`'s own document, sharing its
actual skin/joint hierarchy (so the copied joint indices are correct by
construction) with the original hero mesh, its 84 animation clips, and any
now-orphaned material/texture explicitly disposed before writing — a
gltf-transform `prune()` alone left some of that behind as zero-referrer
orphans (confirmed by inspection) in the version this project pins, which
silently bloated the file and could leave stale `extensionsRequired` entries
a downstream reader refuses to open.

**Runtime rebind gotcha** (`attachGearList` in `Model3DViewer.jsx`): a piece
must bind with `heroSkinned.bindMatrix` — its ORIGINAL matrixWorld, frozen
the moment `GLTFLoader` first constructed it — not `heroSkinned.matrixWorld`
(current). Every viewer normalises the loaded hero to a fixed on-screen
height, which changes `matrixWorld` after load; binding a second skinned
mesh against that later, divergent value desyncs it from the skeleton's own
`boneInverses` (which are still relative to the original bind pose) and
tears the mesh on any pose where different bones rotate by different
amounts. Confirmed by binding a mesh built from hero's OWN geometry/weights
via each matrix — `matrixWorld` teared identically to a genuinely bad
weight-transfer result, `bindMatrix` was pixel-identical to the hero itself.

- **Shield / amulet**: rigid attach like the helmet — the first asset needs a
  `defaults.gear.<slot>` bone (`L_Hand` / `NeckTwist01`) + transform measured
  the same way.

The runtime side is already slot-generic: `getGearPlacements()` in
`src/utils/equipModels.js` resolves whatever is equipped, and
`attachGearList` (shared by `Model3DViewer` and `CombatArena3D`) attaches any
number of pieces — rigid bone-attach or skinned rebind, whichever the
piece's geometry calls for.
