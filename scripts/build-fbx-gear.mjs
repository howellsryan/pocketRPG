#!/usr/bin/env node
// Builds tintable grey-base gear GLTFs from the Quaternius "FBX Extras" pack
// (binary FBX, geometry-only) — the FBX counterpart to
// build-quaternius-weapons.mjs (OBJ) and build-quaternius-shields.mjs (glTF).
// One grey-base model per archetype; the registry per-tier `tint`
// (heroAttach.applyEquipTint, which recolours /steel/i materials) paints
// bronze → runeforged (or per-element for staves) from the same file.
//
// Each source is baked into the SAME canonical pose the registry defaults
// expect, so a new archetype needs only { model, tint } in
// equipmentModels.json:
//   weapons — blade up +Y, grip near origin, centred on X/Z, normalised to a
//             real-world length (source is +Z-long, rotated −90° about X).
//   shields — face in the X-Y plane, boss toward +Z, centred, ~0.62 across
//             (source face-normal is +Y, rotated +90° about X).
//
// Output is self-contained .gltf text (buffer inlined as a data URI) like the
// wooden shield: tiny, diffable, and portable across text-only asset channels.
//
// Run: node scripts/build-fbx-gear.mjs
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup } from '@gltf-transform/functions'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFbx, extractMeshes } from './lib/fbxToMesh.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'assets', 'open-world', 'Quaternius', 'FBX Extras')
const OUT = path.join(ROOT, 'public', '3d-samples')

// Grey ladder for tintable metal (and, for staves, the shaft): the tint
// multiply then recolours it per tier while the light/dark shading survives.
const grey = (name) => (/light/i.test(name) ? 0.85 : /dark/i.test(name) ? 0.42 : 0.62)

// Fixed (never-tinted) colours for non-metal materials, keyed by name keyword.
const WOOD = { lighter: [0.70, 0.54, 0.34], light: [0.60, 0.44, 0.24], mid: [0.48, 0.34, 0.18], dark: [0.30, 0.20, 0.10] }
const woodOf = (n) => (/lighter/i.test(n) ? WOOD.lighter : /dark|brown/i.test(n) ? WOOD.dark : /light/i.test(n) ? WOOD.light : WOOD.mid)
function fixedColour(name) {
  const n = name.toLowerCase()
  if (/ice/.test(n)) return [0.72, 0.90, 1.0]
  if (/gem|crystal|jewel/.test(n)) return [0.30, 0.85, 0.92]
  if (/wood|brown/.test(n)) return woodOf(n)
  if (/gold/.test(n)) return /light/.test(n) ? [0.93, 0.80, 0.42] : [0.83, 0.66, 0.22]
  if (/red/.test(n)) return /light/.test(n) ? [0.85, 0.32, 0.26] : [0.68, 0.13, 0.12]
  if (/black/.test(n)) return [0.07, 0.07, 0.08]
  if (/white/.test(n)) return [0.90, 0.90, 0.93]
  if (/green/.test(n)) return [0.20, 0.55, 0.26]
  if (/blue/.test(n)) return [0.48, 0.66, 0.86]
  return null // unknown → treat as tintable metal below
}

// forceTint: regex list of material names that should be tintable even though
// they aren't metal (a staff's wooden shaft, so each staff recolours per item).
function materialSpec(name, forceTint) {
  const tintable = /steel|silver|metal/i.test(name) || (forceTint || []).some((re) => re.test(name)) || !fixedColour(name)
  if (tintable) { const g = grey(name); return { name: name + '_Steel', kd: [g, g, g], rough: 0.55 } }
  return { name, kd: fixedColour(name), rough: 0.9 }
}

const rotWeapon = (x, y, z) => [x, z, -y] // −90° about X: +Z (tip) → +Y (up)
// +90° about X then 180° about Y: face into X-Y with the boss (this pack's
// front face is on −Z) toward +Z, matching the wooden q_shield so one
// defaults.gear.shield transform serves every shield.
const rotShield = (x, y, z) => [-x, -z, -y]

function bounds(meshes) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    mn[k] = Math.min(mn[k], m.positions[i + k]); mx[k] = Math.max(mx[k], m.positions[i + k])
  }
  return { mn, mx }
}

function rotate(meshes, rot) {
  for (const m of meshes) {
    for (let i = 0; i < m.positions.length; i += 3) {
      const [x, y, z] = rot(m.positions[i], m.positions[i + 1], m.positions[i + 2])
      m.positions[i] = x; m.positions[i + 1] = y; m.positions[i + 2] = z
    }
    for (let i = 0; i < m.normals.length; i += 3) {
      const [x, y, z] = rot(m.normals[i], m.normals[i + 1], m.normals[i + 2])
      m.normals[i] = x; m.normals[i + 1] = y; m.normals[i + 2] = z
    }
  }
}

// Blade up +Y, grip ~16% below origin, centred on X/Z, height = targetLen (m).
function canonWeapon(meshes, targetLen) {
  rotate(meshes, rotWeapon)
  const { mn, mx } = bounds(meshes)
  const s = targetLen / (mx[1] - mn[1])
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) {
    m.positions[i] = (m.positions[i] - cx) * s
    m.positions[i + 1] = (m.positions[i + 1] - mn[1]) * s - 0.16 * targetLen
    m.positions[i + 2] = (m.positions[i + 2] - cz) * s
  }
}

// Face in X-Y plane, boss toward +Z, centred, largest face span = targetSpan.
function canonShield(meshes, targetSpan) {
  rotate(meshes, rotShield)
  const { mn, mx } = bounds(meshes)
  const s = targetSpan / Math.max(mx[0] - mn[0], mx[1] - mn[1])
  const cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) {
    m.positions[i] = (m.positions[i] - cx) * s
    m.positions[i + 1] = (m.positions[i + 1] - cy) * s
    m.positions[i + 2] = (m.positions[i + 2] - mn[2]) * s
  }
}

const ARCHETYPES = [
  // Magic staves — the shaft is forced tintable so each staff recolours per item.
  { fbx: 'Staff', out: 'weapons/q_staff.gltf', kind: 'weapon', len: 1.55, forceTint: [/wood/i] },
  { fbx: 'IceStaff', out: 'weapons/q_ice_staff.gltf', kind: 'weapon', len: 1.55, forceTint: [/staff/i] },
  { fbx: 'WoodenStaff', out: 'weapons/q_wooden_staff.gltf', kind: 'weapon', len: 1.55 },
  // Polearm + two-hander.
  { fbx: 'Spear', out: 'weapons/q_spear.gltf', kind: 'weapon', len: 2.1 },
  { fbx: 'Claymore', out: 'weapons/q_claymore.gltf', kind: 'weapon', len: 1.6 },
  // Extra shields (the plain q_shield_basic is a near-duplicate of the existing
  // wooden q_shield, so it is not built — heater/round/celtic add the variety).
  { fbx: 'Shield_Heater', out: 'shields/q_heater.gltf', kind: 'shield', span: 0.62 },
  { fbx: 'Shield_Round', out: 'shields/q_round.gltf', kind: 'shield', span: 0.62 },
  { fbx: 'Shield_Celtic_Golden', out: 'shields/q_celtic.gltf', kind: 'shield', span: 0.66 },
]

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

for (const a of ARCHETYPES) {
  const meshes = extractMeshes(parseFbx(path.join(SRC, a.fbx + '.fbx')))
  if (a.kind === 'weapon') canonWeapon(meshes, a.len)
  else canonShield(meshes, a.span)

  const doc = new Document()
  const buffer = doc.createBuffer()
  const mesh = doc.createMesh(a.fbx)
  for (const m of meshes) {
    const spec = materialSpec(m.name, a.forceTint)
    const material = doc.createMaterial(spec.name)
      .setBaseColorFactor([...spec.kd, 1]).setRoughnessFactor(spec.rough).setMetallicFactor(0)
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(m.positions)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(m.normals)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(m.indices)).setBuffer(buffer))
      .setMaterial(material)
    mesh.addPrimitive(prim)
  }
  const node = doc.createNode(a.fbx).setMesh(mesh)
  doc.createScene(a.fbx).addChild(node)
  await doc.transform(dedup(), prune())

  const file = path.join(OUT, a.out)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const { json, resources } = await io.writeJSON(doc, { format: 'GLTF' })
  for (const b of json.buffers || []) {
    if (b.uri && resources[b.uri]) b.uri = 'data:application/octet-stream;base64,' + Buffer.from(resources[b.uri]).toString('base64')
  }
  fs.writeFileSync(file, JSON.stringify(json))
  console.log(`wrote ${a.out} (${(fs.statSync(file).size / 1024).toFixed(1)} KiB, ${meshes.length} mats)`)
}
