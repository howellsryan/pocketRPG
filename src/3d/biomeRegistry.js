// Arena biome resolver over src/data/biomes3d.json: placeId → biome spec.
// Unmapped places fall back to the default biome; a malformed registry
// resolves to null and the arena keeps its classic dark-disc look. Kept
// separate from biomes.js so the mount/validate module stays JSON-import-free
// for the dev harness (same split as heroCompose.js / heroCreature.js).

import biomes3dData from '../data/biomes3d.json'

export function getArenaBiomeSpec(placeId) {
  const data = biomes3dData
  if (!data || !data.biomes) return null
  const id = (data.places && data.places[placeId]) || data.default
  const biome = id && data.biomes[id]
  return biome ? { id, ...biome } : null
}

export function listBiomeIds() {
  return Object.keys((biomes3dData && biomes3dData.biomes) || {})
}
