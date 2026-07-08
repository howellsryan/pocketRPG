# 3D armour (gear) pipeline

How an armour piece goes from a Tripo generation to an equippable 3D model on
the hero. Weapons have their own flow (`canonicalize-weapon.mjs`, see
`.claude/rules/tripo-mcp.md`); animations have `docs/hero-animation-retarget-guide.md`.

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
cp helm.glb public/3d-samples/<name>.glb                  # or upload to R2 via import:model / the bridge
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
  shader mask** rather than a bone transform. `setupHeadMask()` in
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

## Other slots (when the first assets arrive)

- **Cape**: rigid attach like the helmet — needs a `defaults.gear.cape` bone +
  transform (chest/spine bone) measured the same way.
- **Body / legs**: rigid attach clips during animation; these need skinned
  meshes sharing the hero skeleton (weight transfer from the nearest hero
  vertices — planned as `canonicalize-armour.mjs`, not built yet).

The runtime side is already slot-generic: `getGearPlacements()` in
`src/utils/equipModels.js` resolves whatever is equipped, and
`attachGearList` (shared by `Model3DViewer` and `CombatArena3D`) attaches any
number of pieces to their bones.
