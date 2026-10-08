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
//
// Multi-form bosses (monsters.json `multiForm`): an entry may carry
// `forms: { formKey: spec }` instead of top-level parts. `formKey` picks the
// combat form; form-less callers (previews, hasCreatureSpec) fall back to
// the entry's `initialForm`, then the first form.
export function getCreatureSpec(monsterId, formKey) {
  let m = monsterId && creatures3dData.monsters && creatures3dData.monsters[monsterId]
  if (m && m.forms && !Array.isArray(m.parts)) {
    const keys = Object.keys(m.forms)
    m = (formKey && m.forms[formKey]) || m.forms[m.initialForm] || m.forms[keys[0]]
  }
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

const CREATURE_ARCHETYPES = new Set(['quadruped', 'biped', 'multileg', 'hopper', 'flyer', 'serpent', 'humanoid'])
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
    if (p.glow !== undefined && typeof p.glow !== 'boolean') errors.push(`${tag}: glow must be a boolean`)
    if (!p.buried && !p.colorOnly) visible++
  }
  if (!visible) errors.push('every part is buried/colorOnly — at least one part must build proxy geometry')

  if (spec.archetype !== undefined && !CREATURE_ARCHETYPES.has(spec.archetype)) {
    errors.push(`archetype must be one of ${[...CREATURE_ARCHETYPES].join('/')}`)
  }
  if (spec.locomotion !== undefined && (spec.locomotion !== 'biped' || spec.archetype !== 'humanoid' || !Array.isArray(spec.legs) || spec.legs.length !== 2)) {
    errors.push('locomotion requires a two-legged humanoid with biped gait')
  }
  if (spec.dissolve !== undefined && typeof spec.dissolve !== 'boolean') errors.push('dissolve must be a boolean')

  // Rig groups: every referenced part must exist, numeric tunables numeric.
  const checkPartList = (tag, list) => {
    if (!Array.isArray(list) || !list.length) { errors.push(`${tag}: parts must be a non-empty array`); return }
    for (const id of list) if (!ids.has(id)) errors.push(`${tag}: references unknown part ${JSON.stringify(id)}`)
  }
  const checkNums = (tag, obj, keys) => {
    for (const k of keys) if (obj[k] !== undefined && !Number.isFinite(obj[k])) errors.push(`${tag}: ${k} must be a number`)
  }
  for (const key of ['breathe', 'head', 'wings', 'spine']) {
    const g = spec[key]
    if (g === undefined) continue
    if (!g || typeof g !== 'object') { errors.push(`${key} must be an object`); continue }
    checkPartList(key, g.parts)
    checkNums(key, g, ['amp', 'rate', 'wave'])
    if (key === 'head' && !isVec3(g.anchor)) errors.push('head needs an [x,y,z] anchor')
  }
  if (spec.arms !== undefined) {
    if (!spec.arms || typeof spec.arms !== 'object') errors.push('arms must be an object')
    else for (const side of ['left', 'right']) {
      const g = spec.arms[side]
      if (g === undefined) continue
      const tag = `arms.${side}`
      if (!g || typeof g !== 'object') { errors.push(`${tag}: must be an object`); continue }
      for (const seg of ['upper', 'lower']) {
        if (g[seg] === undefined) continue
        if (!Array.isArray(g[seg])) { errors.push(`${tag}.${seg}: must be an array`); continue }
        for (const id of g[seg]) if (!ids.has(id)) errors.push(`${tag}.${seg}: references unknown part ${JSON.stringify(id)}`)
      }
      if (!isVec3(g.anchor)) errors.push(`${tag}: needs an [x,y,z] anchor`)
      if (g.elbow !== undefined && !isVec3(g.elbow)) errors.push(`${tag}: elbow must be [x,y,z]`)
      if (g.grip !== undefined && !isVec3(g.grip)) errors.push(`${tag}: grip must be [x,y,z]`)
    }
  }
  if (spec.legs !== undefined) {
    if (!Array.isArray(spec.legs)) errors.push('legs must be an array')
    else for (const [li, leg] of spec.legs.entries()) {
      const tag = `legs[${li}]`
      if (!leg || !ids.has(leg.part)) errors.push(`${tag}: part must name an existing part`)
      if (leg && leg.foot !== undefined && !ids.has(leg.foot)) errors.push(`${tag}: foot references unknown part ${JSON.stringify(leg.foot)}`)
    }
  }
  if (spec.ropes !== undefined) {
    if (!Array.isArray(spec.ropes)) errors.push('ropes must be an array')
    else for (const [ri, rope] of spec.ropes.entries()) {
      const tag = `ropes[${ri}]`
      if (!rope || typeof rope !== 'object') { errors.push(`${tag}: must be an object`); continue }
      checkPartList(tag, rope.parts)
      if (rope.anchorTo !== undefined && !ids.has(rope.anchorTo)) errors.push(`${tag}: anchorTo references unknown part ${JSON.stringify(rope.anchorTo)}`)
      checkNums(tag, rope, ['gravity', 'sway', 'stiffness'])
    }
  }
  return errors
}
