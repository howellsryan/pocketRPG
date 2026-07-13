// Arena biome resolver over src/data/biomes3d.json: (placeId, monsterId) →
// biome spec. A monster override (boss lairs) beats the place mapping;
// unmapped places fall back to the default biome; a malformed registry
// resolves to null and the arena keeps its classic dark-disc look. Kept
// separate from biomes.js so the mount/validate module stays JSON-import-free
// for the dev harness (same split as heroCompose.js / heroCreature.js).

import biomes3dData from '../data/biomes3d.json'

export function getArenaBiomeSpec(placeId, monsterId) {
  const data = biomes3dData
  if (!data || !data.biomes) return null
  const id = (data.monsters && data.monsters[monsterId])
    || (data.places && data.places[placeId])
    || data.default
  const biome = id && data.biomes[id]
  return biome ? { id, ...biome } : null
}

export function listBiomeIds() {
  return Object.keys((biomes3dData && biomes3dData.biomes) || {})
}
