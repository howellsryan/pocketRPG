# New 3D gear asset — the process

The checklist for taking any equippable asset from "I have a GLB / I want to
generate one" to "live on the hero in game". Follow the steps in order; each
one says which tool to run and what you should see. Deep technical detail
lives in `docs/gear-3d-pipeline.md` (armour), `.claude/rules/tripo-mcp.md`
(weapons/asset hosting), `docs/hero-animation-retarget-guide.md` (animations).

**The one manual step is the fit.** Automatic fitting was tried hard (three
different algorithms over two days) and fails structurally: an asset authored
on a different body either stays misfitted or has its authored shape
destroyed. So: a human fits each *base* asset onto the hero once in Blender
(~10–15 minutes); every other step — weights, tier recolours, registry,
tests — is scripted. Tier variants are free (recoloured from the base), so
one fit covers a whole metal line.

## Step 1 — Decide the path for the slot

| Slot (items.json)   | Path        | Why                                    |
| ------------------- | ----------- | -------------------------------------- |
| `weapon`            | rigid       | rides `R_Hand`, `canonicalize-weapon`  |
| `shield`            | rigid       | rides `L_Hand`, weapon-style transform |
| `head`              | rigid       | rides `Head`, `fit-headgear` snug bake |
| `neck` (amulets)    | rigid       | rides `NeckTwist01`, small + stiff     |
| `ring`, `ammo`      | —           | too small to render on the hero (skip) |
| `body`, `legs`      | **skinned** | must bend at shoulder/hip/knee         |
| `boots`, `gloves`   | **skinned** | must bend at ankle/wrist               |
| `cape`              | **skinned** | must follow the spine (stiff-cloth v1) |

- **Rigid** pieces are parented to one bone with a registry transform.
  Weapons and helms are live — copy their flow. The *first* shield/amulet
  needs its `defaults.gear.<slot>` transform measured once (same
  render-and-iterate method used for the helm; see gear-3d-pipeline.md).
- **Skinned** pieces share the hero's skeleton and need the Blender fit
  (steps 3–4) before baking.

## Step 2 — Author or generate the raw asset

- Low-poly / smart-mesh output (a few thousand tris), standard texture —
  `process-3d-model.mjs` shrinks textures to 512px anyway.
- **Worn shape** (the shape as worn, not laid flat), no body inside.
- **Neutral grey-steel colouring** if the item has metal tiers — every tier
  is recoloured from the one base model (step 7).
- Multi-piece generations (torso + legs in one file): split first —
  `node scripts/split-gear-glb.mjs raw.glb --list` then `--extract`
  (see gear-3d-pipeline.md "Multi-part uploads").

## Step 3 — Fit the piece in Blender (skinned slots; the manual step)

One-time per base asset. Any Blender 3.6+.

1. **Import the hero**: File → Import → glTF 2.0 → `public/3d-samples/hero.glb`.
   Do not move, scale or pose it — it IS the coordinate space the game uses.
2. **Import the raw piece** (same menu).
3. **Fit it**: select the piece; `G` move, `S` scale, `R` rotate to drape it
   over the right body region. Work from front/side/top (numpad 1/3/7),
   toggle X-ray (Alt+Z) to see the body through the piece. Aim for a small,
   even gap (~2–4cm at the hero's scale) everywhere; nowhere under the skin.
   - Optional power tool: add a **Shrinkwrap** modifier on the piece
     (target: the hero mesh, mode: Nearest Surface Point, offset ~0.02),
     then Ctrl+A → Apply → Visual Geometry to Mesh. Good for the final snug;
     do the coarse placement by hand first. Skip it if it crumples details.
   - For local tweaks (a pauldron poking through a shoulder): Edit Mode,
     proportional editing (`O`), drag the offending verts out.
4. **Bake the transform**: with the piece selected, Ctrl+A → All Transforms.
5. **Export the piece alone**: File → Export → glTF 2.0, format **glTF
   Binary (.glb)**, tick **Include → Limit to Selected Objects** (the hero
   must NOT be in the file), save as `<item>.fitted.glb`.

The next step's tool verifies the fit (90% of vertices must sit within
~13cm of the hero's surface for that slot) and refuses unfitted input, so a
wrong export surfaces immediately, not in game.

## Step 4 — Bake to a skinned, hero-rigged mesh

```bash
node scripts/canonicalize-armour.mjs <item>.fitted.glb <item>.raw.glb --slot body   # legs|boots|gloves|cape
```

Strips any leftover mannequin-skin scraps (flesh-coloured texels; disable
with `--keep-skin` if the piece legitimately uses skin tones), transfers the
hero's own skin weights onto the piece (side-restricted so a left greave
never binds a right-leg bone), and outputs a mesh sharing the hero's
skeleton. Rigid slots skip this: helms go through `fit-headgear.mjs`,
weapons through `canonicalize-weapon.mjs`.

## Step 5 — Process for shipping

```bash
node scripts/process-3d-model.mjs <item>.raw.glb <item>.glb --ratio 1.0 --tex 512
```

## Step 6 — Host the file

- Small/base items: copy into `public/3d-samples/` (served from the repo).
- Or upload to R2 via `npm run import:model` / the tripo bridge and use the
  `/api/tripo-assets/<id>` path in the registry; run `npm run promote:assets`
  after merge to copy preview-bucket assets to production.

## Step 7 — Tier recolours (metal lines)

Add one entry per tier to `scripts/model-variants.json` (key = variant item
id, `base` = the fitted steel item, hues from the tier colours in
`src/data/bespokeIcons.json`), then generate each with:

```bash
node scripts/recolor-model.mjs <base>.glb <tier>.glb --grey 0.4 --to <hue> --sat <s> --light <l>
```

Recolouring only touches texture pixels — mesh, skin and fit carry over
untouched, which is why one manual fit covers the whole tier line.

## Step 8 — Register in `src/data/equipmentModels.json`

Under `gear`, one entry per item id (ids must exist in `items.json` with the
same slot — a test enforces it):

```jsonc
"steel_platebody": { "model": "platebody.glb", "slot": "body", "hideBody": true },
"steel_platelegs": { "model": "platelegs.glb", "slot": "legs", "hideLegs": true },
"steel_full_helm": { "model": "full_helm.glb", "slot": "head", "hideHead": true }
```

- Skinned pieces need **no transform fields** — fit is baked into the mesh.
- **Covering** pieces set the matching hide flag (`hideHead`/`hideBody`/
  `hideLegs`): a per-vertex shader mask (`setupHideMask` in
  `Model3DViewer.jsx`) removes the hero's covered anatomy so skin can never
  bulge through in any pose. Open pieces (hats, a waistcoat) omit it.
  Boots/gloves/cape have no mask region yet — the first such asset adds its
  bone list to `HIDE_REGION_BONES` (one line) plus a `hideBoots`-style flag
  if the piece needs it.
- Rigid pieces (helm/shield/amulet): `{ model, slot }` picks up the slot's
  `defaults.gear.<slot>` bone + transform.

## Step 9 — Verify before committing

- `npm test` — registry↔items↔files consistency, and every body/legs model
  must carry a 41-joint skin (catches an accidentally-static export).
- Render check: equip the item in Vite dev (3D is always on there) or on the
  branch preview, and watch **idle, an attack, and `hit_head`** in the equip
  screen and combat arena — clip-through and seam artifacts show up in the
  extreme poses, not the idle.

## Step 10 — Ship

Commit gate (`npm test && npm run ci`), push, check the branch preview
deploy, then merge. If assets were uploaded to R2, `npm run promote:assets`
after the merge.
