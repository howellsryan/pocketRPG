# Hero Realism Plan

Decision (2026-07, user): the hero must read as a real human wearing realistic
gear — shields, armour, weapons, staffs, bows, arrows, with real animations.
The blend-shell procedural hero structurally cannot get there (soft-blended
capsules cap out at a wooden-mannequin read; verified via
`render-proc.mjs --hero` side-by-side with the GLB hero). The reference bar
(github.com/hmthanh/3d-human-model) is a rigged, textured human GLB in
three.js — which is exactly this repo's existing Tripo hero pipeline.

**So: the arena hero is the GLB human again** (`arenaHeroProc = null` in
`CombatScreen.jsx`; the arena's GLB + bone-attach/skinned-gear path was kept
intact as the fallback and takes over unchanged). Procedural stays for
monsters and biomes; `hero3d.json` + the harness remain authorable
(`render-proc.mjs --hero`) but no longer ship to players.

## What already exists (don't rebuild)

- **Base hero** `public/3d-samples/hero.glb`: realistic textured human,
  41-joint rig, **84 animation clips** — full sword set (idle, block, dash,
  regular a/b/c, heavy combo), shield set (idle, block-break, dash, bash),
  spell-cast set (`spell_simple_*`), throws, hits (`hit_chest`, `hit_head`,
  `hit_knockback`), `death01`. **No bow set** — the one real animation gap.
- **Weapons**: `canonicalize-weapon.mjs` flow; every scimitar tier + daggers
  registered in `equipmentModels.json`.
- **Helms**: all 7 tiers live, per-vertex hide-mask under full helms.
- **Skinned body/legs armour**: pipeline proven end-to-end
  (`canonicalize-armour.mjs` weight transfer + runtime rebind +
  `hideBody`/`hideLegs` masks, `docs/gear-3d-pipeline.md`) — but **zero body
  or legs assets are registered yet**. Each base asset needs the one-time
  ~10–15 min Blender fit; every tier after that is a scripted recolor.
- **Shield/amulet slots**: rigid attach is slot-generic in `attachGearList`;
  the first asset adds a measured `defaults.gear.<slot>` transform
  (`L_Hand` / `NeckTwist01`).

## Asset backlog

> **Retired route (historical).** This backlog originally sourced grey-base
> GLBs from the Tripo API. That pipeline is retired — PocketRPG no longer uses
> Tripo (or any text/image-to-3D service) for new assets. Author arena
> creatures procedurally (`procgen-creature`) and build hero/weapon/outfit gear
> from the CC0 Quaternius packs (CLAUDE.md §12). Do not reach for a
> `TRIPO_API_KEY`.

Ordered by on-screen impact; each grey base derives all metal tiers via
`recolor-model.mjs` (params in `scripts/model-variants.json`).

1. **Platebody + platelegs** (one grey base each, Blender fit, tier recolors)
   — the hero currently fights bare-chested; this is the visible gap.
2. **Kite/square shield** grey base + `defaults.gear.shield` transform; the
   shield animation set already ships in hero.glb.
3. **Staff** (canonical weapon flow; pair with `spell_simple_*` casts).
4. **Bow + quiver**: bow via canonical weapon flow; quiver as a rigid
   back-slot attach; **retarget a bow animation set** per
   `docs/hero-animation-retarget-guide.md` (draw/loose/idle). Arrow
   projectile VFX is a separate small arena feature, not an asset.
5. **Boots / gloves / cape**: skinned like body/legs; first asset of each
   slot adds its bone list to `HIDE_REGION_BONES`.
6. **Optional — regenerate the base hero** at higher fidelity (Tripo full
   character + auto-rig, re-retarget the clip set) only if the current base
   is judged insufficient *after* it's wearing full armour. Everything
   downstream (masks, canonical fits, `derive-hero-spec.mjs`) re-runs
   against the new GLB, so do this before fitting armour, or accept redoing
   the fits.

## Cheap follow-ups that need no new assets

- **Use the richer clips in the arena**: `sword_regular_a/b/c` variety on
  attack, `sword_block`/`idle_shield_loop` when a shield is equipped,
  `spell_simple_shoot` for magic, `hit_knockback` on big hits. The clips prop
  plumbing (`heroSpec.idleClip/attackClip/specialClip`) already exists.
- **Equip-screen/arena parity**: both now show the same GLB hero, so any new
  asset lands in both for free.
