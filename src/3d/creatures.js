// Procedural creature registry resolver (docs/procedural-3d-plan.md).
//
// Maps a monsterId to a blend-shell spec from src/data/creatures3d.json, or
// null when unregistered — same partial-safe contract as equipModels.js: no
// spec means the caller falls back to the GLB registry or the classic UI.
// Pure data/logic (no three.js, no DOM) so it stays unit-testable; the
// runtime (src/3d/blendShell.js) consumes the resolved spec.

import creatures3dData from '../data/creatures3d.json'

// Resolved spec, or null. Adds arena-facing defaults: `height` is the target
// world height in scene units (hero is ~1.8), `rotationDeg` matches the GLB
// registry default (creatures are authored facing +z; [0,-90,0] faces the
// hero from the right-hand side).
export function getCreatureSpec(monsterId) {
  const m = monsterId && creatures3dData.monsters && creatures3dData.monsters[monsterId]
  if (!m || !Array.isArray(m.parts) || !m.parts.length) return null
  return {
    ...m,
    height: typeof m.height === 'number' ? m.height : 1.4,
    rotationDeg: m.rotationDeg || [0, -90, 0],
  }
}

// Whether a monster has a procedural creature spec (gates the 3D arena).
export function hasCreatureSpec(monsterId) {
  return getCreatureSpec(monsterId) !== null
}

export function listCreatureSpecIds() {
  return Object.keys((creatures3dData && creatures3dData.monsters) || {})
}

const CREATURE_IDLE_KINDS = new Set(['breathe', 'sway', 'twitch', 'chain'])
const CREATURE_MAX_PARTS = 24

function isVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x))
}

// Validate an authored spec. Returns an array of error strings (empty =
// valid). This is the add-content gate for creatures3d.json — every entry
// must pass in tests before it can ship.
export function validateCreatureSpec(spec) {
  const errors = []
  if (!spec || typeof spec !== 'object') return ['spec is not an object']
  if (!Array.isArray(spec.palette) || !spec.palette.length) errors.push('palette must be a non-empty array')
  else for (const c of spec.palette) {
    if (typeof c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c)) errors.push(`palette color ${JSON.stringify(c)} is not a #rrggbb string`)
  }
  if (spec.height !== undefined && !(Number.isFinite(spec.height) && spec.height > 0)) errors.push('height must be a positive number')
  if (spec.rotationDeg !== undefined && !isVec3(spec.rotationDeg)) errors.push('rotationDeg must be [x,y,z]')

  const parts = spec.parts
  if (!Array.isArray(parts) || !parts.length) {
    errors.push('parts must be a non-empty array')
    return errors
  }
  if (parts.length > CREATURE_MAX_PARTS) errors.push(`parts exceeds the ${CREATURE_MAX_PARTS}-primitive budget`)
  const ids = new Set()
  let visible = 0
  for (const p of parts) {
    const tag = p && p.id ? `part ${p.id}` : 'part <no id>'
    if (!p || typeof p.id !== 'string' || !p.id) { errors.push(`${tag}: missing string id`); continue }
    if (ids.has(p.id)) errors.push(`${tag}: duplicate id`)
    ids.add(p.id)
    if (!isVec3(p.a)) errors.push(`${tag}: a must be [x,y,z]`)
    if (!isVec3(p.b)) errors.push(`${tag}: b must be [x,y,z]`)
    for (const r of ['r1', 'r2']) {
      if (!(Number.isFinite(p[r]) && p[r] > 0)) errors.push(`${tag}: ${r} must be a positive number`)
    }
    if (!Number.isInteger(p.color) || p.color < 0 || p.color >= (Array.isArray(spec.palette) ? spec.palette.length : 0)) {
      errors.push(`${tag}: color must index into palette`)
    }
    if (p.blend !== undefined && !(Number.isFinite(p.blend) && p.blend > 0)) errors.push(`${tag}: blend must be a positive number`)
    if (!p.buried) visible++
  }
  if (!visible) errors.push('every part is buried — at least one part must build proxy geometry')

  if (spec.idle !== undefined) {
    if (!Array.isArray(spec.idle)) errors.push('idle must be an array of behaviors')
    else for (const [bi, bh] of spec.idle.entries()) {
      const tag = `idle[${bi}]`
      if (!bh || !CREATURE_IDLE_KINDS.has(bh.kind)) { errors.push(`${tag}: kind must be one of ${[...CREATURE_IDLE_KINDS].join('/')}`); continue }
      if (!Array.isArray(bh.parts) || !bh.parts.length) errors.push(`${tag}: parts must be a non-empty array`)
      else for (const id of bh.parts) if (!ids.has(id)) errors.push(`${tag}: references unknown part ${JSON.stringify(id)}`)
      if (bh.kind === 'sway' && !isVec3(bh.anchor)) errors.push(`${tag}: sway needs an [x,y,z] anchor`)
      for (const k of ['amp', 'rate', 'pitch', 'yaw', 'lag']) {
        if (bh[k] !== undefined && !Number.isFinite(bh[k])) errors.push(`${tag}: ${k} must be a number`)
      }
    }
  }
  return errors
}
