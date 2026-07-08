# Getting New Animations onto the Hero (Beginner Guide)

You have two GLB files:

- **PocketRPGHerov3.glb** — your hero: the mesh (skin), textures, and a skeleton auto-created by Tripo (41 bones with names like `L_Upperarm`, `Spine01`).
- **UAL1_Standard.glb** — the Quaternius **Universal Animation Library**: 43 animations (idle, walk, sword attack, spell cast, death…) made for a *different* skeleton (65 bones with names like `upperarm_l`, `spine_01`, plus fingers).

## Why you can't just copy the animations across

A skeletal animation is a list of instructions like "rotate bone `upperarm_l` 30° at 0.5s".
Your hero has no bone called `upperarm_l` — its equivalent is `L_Upperarm`, and it sits at a
slightly different angle/size. Play the UAL clips on the hero directly and nothing (or a
mangled mess) happens. Moving animations between different skeletons is called
**retargeting**, and something has to translate bone names, rest poses, and proportions.

## The best way for this project: `scripts/retarget-animations.mjs`

Normally you'd learn Blender and a retargeting add-on. You don't have to — this repo now has
a script that does the whole thing in one command using the same three.js the game renders
with. It maps each hero bone to its UAL equivalent, converts every animation, and writes a
new hero GLB with all clips embedded.

### One-time setup

```bash
npm install
npm i -D playwright
npx playwright install chromium   # skip on Claude Code web sessions (already provided)
```

### The one command

```bash
node scripts/retarget-animations.mjs \
  --target path/to/PocketRPGHerov3.glb \
  --source path/to/UAL1_Standard.glb \
  --out PocketRPGHerov3.animated.glb
```

That's it. `PocketRPGHerov3.animated.glb` is your hero — same mesh, same textures, same
skeleton — now containing all 42 UAL animations (the `A_TPose` calibration clip is skipped).

Useful options:

- `--clips Idle_Loop,Sword_Attack,Walk_Loop` — only convert the clips you want (smaller file).
- `--preview frames/` — also renders PNG snapshots of the first clips so you can eyeball the result without opening a 3D tool.
- `--map mymap.json` — swap in a different bone-name map (JSON of `{"TargetBone": "sourceBone"}`) for other rig pairs; the built-in default covers Tripo-rig → UAL/UE-style skeletons.
- `--rename names.json` — rename clips on the way out (JSON of `{"SourceClip": "new_name"}`), e.g. to give the game the exact `idleClip`/`attackClip`/`specialClip` names it references. `--lowercase` lowercases every other clip name for a clean, consistent set.

The `--target` can be the game's live `public/3d-samples/hero.glb` (Meshopt-compressed) — the tool decodes it automatically. The GLB it writes is uncompressed; re-apply Meshopt with gltf-transform (`meshopt()` + `MeshoptEncoder`, as `scripts/canonicalize-weapon.mjs` does) to shrink it back to ~0.6 MB before committing.

This works for **any future animation pack that uses the same UAL/UE-style skeleton**
(Quaternius sells/gives more packs on the same rig) — just point `--source` at the new pack.

### Checking the result

Drag the output file into https://gltf-viewer.donmccurdy.com/ (a free drag-and-drop GLB
viewer) and pick clips from the animation dropdown. Or use `--preview` and look at the PNGs.

### Wiring it into PocketRPG

1. Replace the hero model: copy the output over `public/3d-samples/hero.glb`.
2. Point the game at the new clip names in `src/data/equipmentModels.json` (`character` block).
   The live hero uses UAL 2 clips (renamed via `--rename`):
   ```json
   "character": {
     "model": "hero.glb",
     "idleClip": "idle",
     "attackClip": "sword_attack",
     "specialClip": "sword_regular_combo"
   }
   ```
3. Nothing else changes: the skeleton is untouched, so weapon attachment (`R_Hand` bone,
   canonical grips) keeps working.

Clip inventory (42): Crouch_Fwd_Loop, Crouch_Idle_Loop, Dance_Loop, Death01, Driving_Loop,
Fixing_Kneeling, Hit_Chest, Hit_Head, Idle_Loop, Idle_Talking_Loop, Idle_Torch_Loop,
Interact, Jog_Fwd_Loop, Jump_Land, Jump_Loop, Jump_Start, PickUp_Table, Pistol_* (7),
Punch_Cross, Punch_Jab, Push_Loop, Roll, Sitting_* (4), Spell_Simple_* (4), Sprint_Loop,
Swim_Fwd_Loop, Swim_Idle_Loop, Sword_Attack, Sword_Idle, Walk_Formal_Loop, Walk_Loop.

Note: the hero's original 3 Tripo clips (`NlaTrack*`) are not carried into the output — the
UAL versions are better. Locomotion clips are in-place (no forward drift), ready for game use.

## How the script works (so it isn't magic)

1. Loads both GLBs in headless Chrome with three.js.
2. Rotates the hero to face the same direction as the UAL mannequin (they were exported facing different axes).
3. For each of 22 mapped bone pairs, measures the rest-pose rotation difference and bakes it into an offset, then uses three.js `SkeletonUtils.retargetClip` to resample every animation onto the hero's bones. Hip movement is scaled by the height ratio (your hero is about 57% of the mannequin's height) so feet stay on the floor.
4. Bones that have no UAL equivalent (Tripo's "twist" helper bones) simply follow their parent — invisible in practice.
5. Exports hero mesh + all converted clips as one GLB.

## Alternatives (for reference — you don't need them now)

- **Blender + free retarget add-on (e.g. Rokoko Studio Live)**: import both files, map bones
  by hand, retarget and bake one clip at a time, export. Full artistic control, but slow with
  43 clips and a steep learning curve.
- **Re-skinning**: delete the hero's skeleton in Blender and bind its mesh to the UAL
  skeleton ("Parent → With Automatic Weights"). All UAL clips then play natively, but
  automatic weights can deform clothing badly, and the game's weapon-attachment config would
  need rework (`R_Hand` no longer exists on that skeleton).
- **Mixamo (mixamo.com)**: free Adobe service — upload a character, it auto-rigs and gives you
  its own animation library. Good for quick extra animations, but it needs FBX conversion both
  ways and its clips would again land on a third, different skeleton.

## License note

Quaternius packs are published as CC0 (public domain) — free for commercial use, no credit
required. Double-check the license file that came with your UAL download in case your copy
was the paid/extended edition.
