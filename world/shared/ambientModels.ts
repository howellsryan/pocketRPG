export const AMBIENT_MODELS: Record<string, { url: string; target: number; b: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } }> = {
  chicken: { url: '/models/chicken.glb', target: 0.55, b: { minX: -1.17, maxX: 1.17, minY: -0.01, maxY: 2.34, minZ: -0.8, maxZ: 1.3 } },
  frog: { url: '/models/frog.glb', target: 0.4, b: { minX: -2.32, maxX: 2.32, minY: -0.01, maxY: 2.68, minZ: -0.58, maxZ: 0.97 } },
  // Target 1.6 matches HERO_SCALE's rendered height in entities.ts (Quaternius
  // Ranger outfit, ~1.9 units tall raw × 0.85 ≈ 1.615) — villagers read at the
  // same human scale as the player instead of an arbitrarily different one.
  // Bounds are the actual posed (idle, not bind/T-pose) box from a headless
  // three.js render of the built GLB — Box3.setFromObject in the browser
  // evaluates skinning correctly; gltf-transform's getBounds does not.
  villager_a: { url: '/models/villager_a.glb', target: 1.6, b: { minX: -0.36, maxX: 0.395, minY: -0.004, maxY: 1.796, minZ: -0.323, maxZ: 0.388 } },
  villager_b: { url: '/models/villager_b.glb', target: 1.6, b: { minX: -0.366, maxX: 0.399, minY: -0.004, maxY: 1.774, minZ: -0.335, maxZ: 0.392 } },
  villager_c: { url: '/models/villager_c.glb', target: 1.6, b: { minX: -0.36, maxX: 0.395, minY: -0.004, maxY: 1.796, minZ: -0.323, maxZ: 0.388 } },
}

