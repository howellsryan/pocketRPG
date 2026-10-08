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
  /** Multi-form boss only: form key → the colour its whole body takes while it
   * is in that phase, so the style you must pray against is readable off the
   * boss instead of off a form name in the HUD. Unlike `tint` above (a fixed
   * per-material recolour picked at load) this changes live, blended over the
   * model's own colours — see applyFormTint in entities.ts. */
  formTint?: Record<string, string>
}

/** How far a form's colour overrides the model's own (0 = untinted, 1 = flat
 * colour). High enough to read across a lair at a glance, low enough to leave
 * the horns, eyes and armour of the silhouette distinguishable. */
export const FORM_TINT_MIX = 0.62
/** Emissive lift applied in the phase colour on top of that blend, so the phase
 * still reads in the unlit half of a lair. Low: this is a hint, not a lamp. */
export const FORM_TINT_EMISSIVE = 0.22

/** The colour for the phase this npc is in, or null when its model doesn't
 * phase-tint. Pure lookup, shared by the client and its tests. */
export function formTintColor(monsterId: string | undefined, form: string | null | undefined): string | null {
  if (!monsterId || !form) return null
  return MONSTER_MODELS[monsterId]?.formTint?.[form] ?? null
}

export const MONSTER_MODELS: Record<string, MonsterModel> = {
  field_chicken: {
    url: '/models/chicken.glb',
    bounds: { minX: -1.17, minY: -0.01, minZ: -0.8, maxX: 1.17, maxY: 2.34, maxZ: 1.3 },
    targetHeight: 0.9,
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
  // The low flying mesh is much wider than it is tall. Keep its wingspan
  // below five tiles so mobile encounter views retain the player and court.
  // Its 3×3 combat footprint (shared/monsterSize.ts) remains unchanged.
  green_dragon: {
    url: '/models/dragon.glb',
    bounds: { minX: -2.19, minY: 1.6, minZ: -1.43, maxX: 2.19, maxY: 3.14, maxZ: 1.0 },
    targetHeight: 1.3,
    hover: 0.25,
    attackImpactSec: 0.55,
    tint: { Dragon_Main: '#3f7a35', Dragon_Secondary: '#24451f' },
  },
  red_dragon: {
    url: '/models/dragon.glb',
    bounds: { minX: -2.19, minY: 1.6, minZ: -1.43, maxX: 2.19, maxY: 3.14, maxZ: 1.0 },
    targetHeight: 1.45,
    hover: 0.25,
    attackImpactSec: 0.55,
    tint: { Dragon_Main: '#8f2118', Dragon_Secondary: '#3d0f0a' },
  },
  black_dragon: {
    url: '/models/dragon.glb',
    bounds: { minX: -2.19, minY: 1.6, minZ: -1.43, maxX: 2.19, maxY: 3.14, maxZ: 1.0 },
    targetHeight: 1.6,
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
  // The only monster with a per-style swing: it ships attack (melee) and
  // attack_ranged, with attack_magic copied from the latter by
  // scripts/build-zaryth-the-empty-lord.mjs. Its walk is retargeted onto this
  // rig from the Quaternius UAL by that same script — the source ships no
  // locomotion clip, and the idle-alias + procedural bob every other clipless
  // boss falls back to read as a statue skating across its own throne room.
  // Bounds baked from that script.
  zaryth_the_empty_lord: {
    url: '/models/zaryth_the_empty_lord.glb',
    bounds: { minX: -0.528, minY: 0, minZ: -0.105, maxX: 0.466, maxY: 0.982, maxZ: 0.217 },
    targetHeight: 3.2,
    noShadow: true,
    // Every style swings with the AttackRanged clip (src/engine/monsterClips.js),
    // which rears back to a raised claw at 2.0s and brings it down at 2.1 — the
    // frame the splat has to land on. The old 1.2 was the melee clip's impact,
    // and against this one it fired the splat mid-wind-up, most of a second
    // before the blow arrived. Capped by the 6-tick attack cycle: the lead is
    // ceil(impact/tick) = 4 ticks, and the countdown only passes through 5…1.
    attackImpactSec: 2.1,
    // It rerolls its style every swing, so the phase has to be readable at a
    // glance from across the throne room: red to pray melee, green ranged,
    // blue magic — the same three hues as the overhead prayer icons.
    formTint: { melee: '#d63b2c', ranged: '#35a94b', magic: '#3f74e0' },
  },
  // The sentinels Zaryth summons mid-fight (minions.ts). One KayKit skeleton rig
  // in three kits, armed to match the style each is summoned for — built by
  // world/scripts/build-skeleton-sentinels.mjs, bounds baked from its output.
  // Shorter than the boss on purpose: a minion that reads as its equal in the
  // silhouette is a second boss, not an add.
  zaryth_blade_sentinel: {
    url: '/models/skeleton_warrior.glb',
    bounds: { minX: -1.169, minY: 0, minZ: -0.758, maxX: 1.319, maxY: 2.59, maxZ: 1.168 },
    targetHeight: 1.8,
  },
  zaryth_bolt_sentinel: {
    url: '/models/skeleton_rogue.glb',
    bounds: { minX: -1.439, minY: 0, minZ: -0.582, maxX: 0.971, maxY: 2.308, maxZ: 0.571 },
    targetHeight: 1.8,
  },
  zaryth_rune_sentinel: {
    url: '/models/skeleton_mage.glb',
    bounds: { minX: -1.023, minY: 0, minZ: -0.848, maxX: 0.969, maxY: 2.63, maxZ: 1.255 },
    targetHeight: 1.8,
  },
}

/** Monsters that render with a bespoke model (registry above). Anything else
 * falls back to the cow, or to a placeholder box in-game. */
export const MODELED_MONSTERS = new Set<string>(Object.keys(MONSTER_MODELS))
