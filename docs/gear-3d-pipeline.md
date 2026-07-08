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
`{ "model": "<file>", "slot": "head" }` is the whole entry; the shared
`defaults.gear.head` transform (bone `Head`, measured from the hero's skull
vertices) places every canonically-fitted piece. `tests/equipModels.test.ts`
enforces registry ↔ items.json ↔ file-on-disk consistency.

Fit notes: the default margins are the snug full-helm fit (a few % clearance,
front shifted so the hair fringe can't poke through). Open headwear that
shouldn't hug the skull (hats, hoods) may want `--margins`/`--shift`
overrides. Verify with a render before committing — clip-through shows up
most in the `hit_head` and `sword_attack` clips.

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
