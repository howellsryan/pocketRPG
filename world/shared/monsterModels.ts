// Per-monster 3D model registry, shared by the world client (renders them) and
// the editor (badges which monsters have a bespoke model). Bounds are baked from
// each build script's output — THREE.Box3.setFromObject is unreliable for
// skinned meshes; `targetHeight` scales against 1-unit tiles; `hover` lifts
// flyers off the ground. Pure data, no THREE import, so both sides can use it.

export type MonsterModel = {
  url: string
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
  targetHeight: number
  hover?: number
  /** True when the GLB ships no walk clip, so makeAnimator aliases walk to
   * idle (a wandering boss would otherwise glide with no visible gait) —
   * entities.ts layers a procedural bob/rock (motion.ts gaitBob) on top of
   * the idle clip while moving instead. */
  noLocomotionClip?: boolean
  /** Keep this monster out of the sun's shadow pass. The shadow map is sized
   * for the area around the hero, so a model several tiles tall smears a shadow
   * across it that reads worse than none — especially indoors, under a dim sun. */
  noShadow?: boolean
  /** Material name → replacement colour, applied on load so several monsters
   * can share one GLB (the three dragons do). Keyed by material name because
   * these Quaternius models are untextured solid colours — recolouring
   * everything would flatten horns and eyes into the hide. */
  tint?: Record<string, string>
  /** Seconds into this model's `attack` clip at which the blow lands. The
   * client starts the clip late by the remainder of the tick so the impact
   * frame hits on the same beat as the damage splat. Absent → the clip starts
   * on the swing tick with no alignment. */
  attackImpactSec?: number
}

export const MONSTER_MODELS: Record<string, MonsterModel> = {
  field_chicken: {
    url: '/models/chicken.glb',
    bounds: { minX: -1.17, minY: -0.01, minZ: -0.8, maxX: 1.17, maxY: 2.34, maxZ: 1.3 },
    targetHeight: 0.9,
  },
  cave_goblin: {
    url: '/models/goblin.glb',
    bounds: { minX: -2.19, minY: 1.49, minZ: -1.43, maxX: 2.19, maxY: 3.04, maxZ: 0.51 },
    targetHeight: 1.0,
    hover: 0.25,
  },
  arcane_adept: {
    url: '/models/wizard.glb',
    bounds: { minX: -1.16, minY: 0, minZ: -1.23, maxX: 1.17, maxY: 2.6, maxZ: 1.08 },
    targetHeight: 1.5,
  },
  bogling_sprite: {
    url: '/models/blob.glb',
    bounds: { minX: -1.05, minY: -0.01, minZ: -1.06, maxX: 1.2, maxY: 1.84, maxZ: 1.14 },
    targetHeight: 0.8,
  },
  frostbite_imp: {
    url: '/models/imp.glb',
    bounds: { minX: -2.31, minY: -0.01, minZ: -0.62, maxX: 2.31, maxY: 2.83, maxZ: 1.54 },
    targetHeight: 1.2,
  },
  marshfen_toad: {
    url: '/models/frog.glb',
    bounds: { minX: -2.32, minY: -0.01, minZ: -0.58, maxX: 2.32, maxY: 2.68, maxZ: 0.97 },
    targetHeight: 1.1,
  },
  lesser_fiend: {
    url: '/models/demon.glb',
    bounds: { minX: -2.33, minY: -0.02, minZ: -1.33, maxX: 2.33, maxY: 3.1, maxZ: 0.99 },
    targetHeight: 2.0,
    attackImpactSec: 0.5,
  },
  // The bull predates the registry and rendered through the unregistered-monster
  // fallback (createCowMesh, which scales by body LENGTH). targetHeight is that
  // same on-screen size expressed as a height: 1.6 * 5.15 / 9.18.
  pasture_bull: {
    url: '/models/cow.glb',
    bounds: { minX: -1.12, minY: -0.07, minZ: -3.78, maxX: 1.12, maxY: 5.08, maxZ: 5.4 },
    targetHeight: 0.8976,
    attackImpactSec: 0.8,
  },
  // One dragon build, three hides. Sized by combat level (79 / 152 / 227); the
  // GLB only flies (Flying_Idle / Fast_Flying), so they hover as they wander.
  // Deliberately the largest things in the world — they also carry a 3×3
  // footprint (shared/monsterSize.ts) so a player fights the head instead of
  // standing under the jaw.
  green_dragon: {
    url: '/models/dragon.glb',
    bounds: { minX: -2.19, minY: 1.6, minZ: -1.43, maxX: 2.19, maxY: 3.14, maxZ: 1.0 },
    targetHeight: 2.6,
    hover: 0.25,
    attackImpactSec: 0.55,
    tint: { Dragon_Main: '#3f7a35', Dragon_Secondary: '#24451f' },
  },
  red_dragon: {
    url: '/models/dragon.glb',
    bounds: { minX: -2.19, minY: 1.6, minZ: -1.43, maxX: 2.19, maxY: 3.14, maxZ: 1.0 },
    targetHeight: 3.0,
    hover: 0.25,
    attackImpactSec: 0.55,
    tint: { Dragon_Main: '#8f2118', Dragon_Secondary: '#3d0f0a' },
  },
  black_dragon: {
    url: '/models/dragon.glb',
    bounds: { minX: -2.19, minY: 1.6, minZ: -1.43, maxX: 2.19, maxY: 3.14, maxZ: 1.0 },
    targetHeight: 3.4,
    hover: 0.25,
    attackImpactSec: 0.55,
    tint: { Dragon_Main: '#26262b', Dragon_Secondary: '#111114' },
  },
  // Dungeon boss — the imported GLB replaces its creatures3d blend-shell. Ships
  // idle + attack + die (walk aliases idle in makeAnimator — no locomotion
  // clip). Bounds baked from scripts/build-warlord-grondar.mjs.
  warlord_grondar: {
    url: '/models/warlord_grondar.glb',
    bounds: { minX: -1.0, minY: -0.874, minZ: -0.503, maxX: 1.0, maxY: 0.874, maxZ: 0.503 },
    targetHeight: 2.8,
    noLocomotionClip: true,
    noShadow: true,
  },
}

/** Monsters that render with a bespoke model (registry above). Anything else
 * falls back to the cow, or to a placeholder box in-game. */
export const MODELED_MONSTERS = new Set<string>(Object.keys(MONSTER_MODELS))
