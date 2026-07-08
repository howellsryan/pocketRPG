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
  bigger than the skull and can't be hidden by material (single-mesh Tripo
  rig), so `attachGearList` shrinks the Head bone to 0.3 and counter-scales
  the helm — hair tucks inside the shell, the visor shows the (double-sided)
  shell interior, and the neck tapers naturally into the rim. Full collapse
  (scale ≈ 0) is wrong: upper-neck vertices share Head weights, so the neck
  severs during `hit_head`.
- **Open headwear** (hats, hoods, circlets — head stays visible): no
  `hideHead`; the piece must contain the hair, so bake with hair-sized
  margins, e.g. `--margins 1.25,1.12,1.06 --shift 0.06 --lift 0`.

Verify with a render before committing — clip-through and neck artifacts show
up most in the `hit_head` and `sword_attack` clips.

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
