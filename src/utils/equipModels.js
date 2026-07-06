// Equipment 3D model registry resolver.
//
// Maps an equipped item to an optional 3D model + the transform that places it
// on the character (weapon → hand bone for now; the schema already carries a
// `bone` per entry so armour slots can be layered later without a shape change).
// When an item has no registered model the resolver returns null and the caller
// falls back to the existing icon UI — 3D coverage is always partial-safe.
//
// Pure data/logic (no three.js, no DOM) so it stays unit-testable and outside
// the render path. The viewer component consumes these specs; it never reads the
// JSON directly.

import equipmentModelsData from '../data/equipmentModels.json'

const IDENTITY = { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: 1 }

// Character (hero) model spec, or null if none configured.
export function getCharacterModel() {
  return equipmentModelsData.character || null
}

// Resolve a weapon itemId to a placement spec, or null when unregistered.
// Shape: { model, bone, position:[x,y,z], rotationDeg:[x,y,z], scale }.
export function getWeaponModel(itemId) {
  if (!itemId) return null
  const w = equipmentModelsData.weapons && equipmentModelsData.weapons[itemId]
  if (!w || !w.model) return null
  return {
    model: w.model,
    bone: w.bone || (equipmentModelsData.defaults && equipmentModelsData.defaults.handBone) || null,
    position: w.position || IDENTITY.position,
    rotationDeg: w.rotationDeg || IDENTITY.rotationDeg,
    scale: typeof w.scale === 'number' ? w.scale : IDENTITY.scale,
  }
}

// Whether an item currently has a 3D model (cheap check for UI gating).
export function hasWeaponModel(itemId) {
  return Boolean(itemId && equipmentModelsData.weapons && equipmentModelsData.weapons[itemId] && equipmentModelsData.weapons[itemId].model)
}

// Resolve a bare model filename to a fetchable URL. `base` defaults to the
// registry's modelBase; callers in a non-root-served context (e.g. Vite dev)
// can pass their own base.
export function modelUrl(model, base) {
  if (!model) return null
  if (/^(https?:)?\/\//.test(model) || model.startsWith('/')) return model
  const b = base || equipmentModelsData.modelBase || '/'
  return b.endsWith('/') ? b + model : b + '/' + model
}
