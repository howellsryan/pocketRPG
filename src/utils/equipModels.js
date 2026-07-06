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

const EQUIP_IDENTITY = { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: 1 }

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
    position: w.position || EQUIP_IDENTITY.position,
    rotationDeg: w.rotationDeg || EQUIP_IDENTITY.rotationDeg,
    scale: typeof w.scale === 'number' ? w.scale : EQUIP_IDENTITY.scale,
  }
}

// Whether an item currently has a 3D model (cheap check for UI gating).
export function hasWeaponModel(itemId) {
  return Boolean(itemId && equipmentModelsData.weapons && equipmentModelsData.weapons[itemId] && equipmentModelsData.weapons[itemId].model)
}

// Resolve a monsterId to a combat-arena spec, or null when unregistered.
// `height` is the target world height in scene units (hero is ~1.8) so a
// dragon can tower without per-model scale guesswork.
export function getMonsterModel(monsterId) {
  const m = monsterId && equipmentModelsData.monsters && equipmentModelsData.monsters[monsterId]
  if (!m || !m.model) return null
  return {
    path: resolveModelPath(m.model),
    height: typeof m.height === 'number' ? m.height : 2,
  }
}

// Whether a monster has a registered 3D model (gates the 3D combat arena).
export function hasMonsterModel(monsterId) {
  return getMonsterModel(monsterId) !== null
}

// Join a registry `model` with `modelBase`. Both may be a full URL: an
// absolute `model` (e.g. a per-item R2 URL) skips the base entirely, and an
// absolute `modelBase` (e.g. "https://assets.example.com/models/") flows
// through untouched — three3d.js's assetUrl() passes absolute URLs through
// without prepending the deployment prefix. This is the R2 migration seam:
// point modelBase (or one entry) at the bucket and nothing else changes.
function resolveModelPath(model) {
  if (!model) return null
  if (/^(https?:)?\/\//.test(model) || model.startsWith('/')) return model
  return (equipmentModelsData.modelBase || '') + model
}

// Path for the character model, e.g. '3d-samples/hero.glb' (resolved against
// the probed asset prefix — see three3d.js) or a full URL when the registry
// points at remote storage.
export function getCharacterAssetPath() {
  const c = getCharacterModel()
  return c ? resolveModelPath(c.model) : null
}

// Placement spec for an equipped weapon with a fetchable `path`, or null.
export function getWeaponPlacement(itemId) {
  const spec = getWeaponModel(itemId)
  if (!spec) return null
  return {
    path: resolveModelPath(spec.model),
    bone: spec.bone,
    position: spec.position,
    rotationDeg: spec.rotationDeg,
    scale: spec.scale,
  }
}

// Deployment-root prefix for static assets. The single-file build serves
// public/ under /public/ (build_single injects `pocketAssetBase='/public/'`);
// Vite dev and the dist build serve it at root, where the global is undefined
// and this falls back to '/'. `typeof` guard so it's safe in Node tests too.
function equipAssetBase() {
  return (typeof pocketAssetBase !== 'undefined' && pocketAssetBase) || '/'
}

// Resolve a bare model filename to a fetchable URL. Defaults to
// `<assetBase><modelBase><model>` so it works in every build; already-absolute
// URLs pass through, and callers may override `base` explicitly.
export function modelUrl(model, base) {
  if (!model) return null
  if (/^(https?:)?\/\//.test(model) || model.startsWith('/')) return model
  const b = base || equipAssetBase() + (equipmentModelsData.modelBase || '')
  return b.endsWith('/') ? b + model : b + '/' + model
}
