// App-facing resolver for the procedural blend-shell hero (hero3d.json +
// heroCompose.js). Same partial-safe contract as creatures.js: no hero spec
// (or an unregistered equipped item) never breaks anything — the caller falls
// back to the GLB hero / icon UI.

import hero3dData from '../data/hero3d.json'
import { heroComposeSpec, heroResolveEquipEntry } from './heroCompose.js'

// Composed hero spec wearing the given equipped itemIds (unregistered ids are
// skipped, so partial 3D equipment coverage is safe), or null when no hero
// spec is authored.
export function composeHeroSpec3D(itemIds = []) {
  return heroComposeSpec(hero3dData, itemIds)
}

export function hasHeroSpec3D() {
  return composeHeroSpec3D([]) !== null
}

// Whether an item renders on the procedural hero (cheap UI/coverage check).
export function hasHeroEquip3D(itemId) {
  return Boolean(itemId && hero3dData.equipment && hero3dData.equipment[itemId])
}

export function listHeroEquip3DIds() {
  return Object.keys((hero3dData && hero3dData.equipment) || {})
}

// Registry entry with any variantOf resolved against its base (tests and
// tooling want the effective add/override/palette, not the raw variant stub).
export function getHeroEquipEntry(itemId) {
  const equipment = (hero3dData && hero3dData.equipment) || {}
  return heroResolveEquipEntry(equipment, equipment[itemId])
}
