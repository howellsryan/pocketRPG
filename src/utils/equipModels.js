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
// Omitted fields fall back to `defaults` (handBone + the canonical-grip
// `defaults.weapon` transform, so canonicalized imports need only `model`).
// An EXPLICIT `bone: null` means "attach at the model root" — only an absent
// bone falls back to the default hand bone (the 3d-preview aligner emits null
// for root-tuned transforms; coercing it to the hand bone applies a
// root-space transform in bone space and lands the weapon somewhere else).
export function getWeaponModel(itemId) {
  if (!itemId) return null
  const w = equipmentModelsData.weapons && equipmentModelsData.weapons[itemId]
  if (!w || !w.model) return null
  const defaults = equipmentModelsData.defaults || {}
  const dw = defaults.weapon || {}
  return {
    model: w.model,
    bone: w.bone === undefined ? (defaults.handBone || null) : w.bone,
    position: w.position || dw.position || EQUIP_IDENTITY.position,
    rotationDeg: w.rotationDeg || dw.rotationDeg || EQUIP_IDENTITY.rotationDeg,
    scale: typeof w.scale === 'number' ? w.scale : (typeof dw.scale === 'number' ? dw.scale : EQUIP_IDENTITY.scale),
  }
}

// Resolve a gear (armour) itemId to a placement spec, or null when
// unregistered. Same shape as weapons plus `slot`; omitted transform fields
// fall back to the slot's entry in `defaults.gear` so a canonically-authored
// piece needs only { model, slot }.
export function getGearModel(itemId) {
  if (!itemId) return null
  const g = equipmentModelsData.gear && equipmentModelsData.gear[itemId]
  if (!g || !g.model || !g.slot) return null
  const d = ((equipmentModelsData.defaults || {}).gear || {})[g.slot] || {}
  return {
    model: g.model,
    slot: g.slot,
    bone: g.bone === undefined ? (d.bone || null) : g.bone,
    position: g.position || d.position || EQUIP_IDENTITY.position,
    rotationDeg: g.rotationDeg || d.rotationDeg || EQUIP_IDENTITY.rotationDeg,
    scale: typeof g.scale === 'number' ? g.scale : (typeof d.scale === 'number' ? d.scale : EQUIP_IDENTITY.scale),
    // fully-enclosing pieces cut the hero region they cover out of the render so
    // hair/skin can't clip through the shell (helm→head, platebody→torso). Falls
    // back to the slot default so every body piece inherits it from one place.
    hideHead: Boolean(g.hideHead !== undefined ? g.hideHead : d.hideHead),
    hideBody: Boolean(g.hideBody !== undefined ? g.hideBody : d.hideBody),
  }
}

// Placement spec for one gear item with a fetchable `path`, or null.
export function getGearPlacement(itemId) {
  const spec = getGearModel(itemId)
  if (!spec) return null
  return {
    path: resolveModelPath(spec.model),
    slot: spec.slot,
    bone: spec.bone,
    position: spec.position,
    rotationDeg: spec.rotationDeg,
    scale: spec.scale,
    hideHead: spec.hideHead,
    hideBody: spec.hideBody,
  }
}

// Placement specs for every registered piece the character has equipped
// (weapon excluded — it has its own attach path). Unregistered items are
// simply skipped, so 3D gear coverage is partial-safe like everything else.
export function getGearPlacements(equipment) {
  const out = []
  if (!equipment) return out
  for (const slot of Object.keys(equipment)) {
    if (slot === 'weapon') continue
    const itemId = equipment[slot] && equipment[slot].itemId
    const p = itemId ? getGearPlacement(itemId) : null
    if (p) out.push(p)
  }
  return out
}

// Whether an item currently has a 3D model (cheap check for UI gating).
export function hasWeaponModel(itemId) {
  return Boolean(itemId && equipmentModelsData.weapons && equipmentModelsData.weapons[itemId] && equipmentModelsData.weapons[itemId].model)
}

// Resolve a monsterId to a combat-arena spec, or null when unregistered.
// `height` is the target world height in scene units (hero is ~1.8) so a
// dragon can tower without per-model scale guesswork.
// Optional `rotationDeg` corrects a GLB not authored facing the arena's
// assumed axis (default [0,-90,0] faces the hero from the right-hand side).
export function getMonsterModel(monsterId) {
  const m = monsterId && equipmentModelsData.monsters && equipmentModelsData.monsters[monsterId]
  if (!m || !m.model) return null
  return {
    path: resolveModelPath(m.model),
    height: typeof m.height === 'number' ? m.height : 2,
    rotationDeg: m.rotationDeg || [0, -90, 0],
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
