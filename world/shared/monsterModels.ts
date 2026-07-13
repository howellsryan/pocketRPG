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
}

/** Monsters that render with a bespoke model (registry above) or the cow
 * fallback used by unregistered monsters (`pasture_bull`). Anything else falls
 * back to a placeholder box in-game. */
export const MODELED_MONSTERS = new Set<string>([...Object.keys(MONSTER_MODELS), 'pasture_bull'])
