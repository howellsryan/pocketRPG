#!/usr/bin/env node
// Builds public/3d-samples/amulets/necklace{1,2,3}.glb — rigid neck-slot props
// for the arena/equip-screen hero — from the Quaternius Ultimate RPG Items Pack
// necklace OBJs. These are small static meshes (no rig): the runtime attaches
// them to the hero's neck bone (src/data/equipmentModels.json defaults.gear.neck)
// and recolours the whole model with the per-item registry `tint`
// (heroAttach.applyEquipTint, allMaterials for neck/cape). So the source metal/
// gem colours are baked to a neutral grey ladder here — otherwise a multiply
// tint can't shift the strong gold/lilac source hues to the item's icon colour.
//
// Run: node scripts/build-quaternius-jewellery.mjs
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune } from '@gltf-transform/functions'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OBJ_DIR = path.join(
  ROOT, 'assets', 'open-world', 'Quaternius',
  'Ultimate RPG Items Pack - Aug 2019-20260709T194650Z-2-001',
  'Ultimate RPG Items Pack - Aug 2019', 'OBJ',
)
const OUT_DIR = path.join(ROOT, 'public', '3d-samples', 'amulets')

// Neutral grey ladder so the per-item tint reads true; keeps a subtle metal/gem
// two-tone (chain lighter than gem) after the multiply.
const GREY = { Golden: [0.85, 0.85, 0.85, 1], DarkBrown: [0.5, 0.5, 0.5, 1], Lilac: [0.7, 0.7, 0.7, 1] }
const DEFAULT_GREY = [0.8, 0.8, 0.8, 1]

// Minimal OBJ parser: v / vn / f (triangulated by fan), grouped per usemtl.
// The pack's necklaces carry vt too, but with no textures we drop UVs.
function parseObj(text) {
  const positions = [], normals = []
  const groups = new Map() // material -> { position:[], normal:[], index:[], map:Map }
  let cur = 'default'
  const groupFor = (m) => {
    if (!groups.has(m)) groups.set(m, { position: [], normal: [], index: [], map: new Map() })
    return groups.get(m)
  }
  const vert = (g, token) => {
    let idx = g.map.get(token)
    if (idx !== undefined) return idx
    const [vi, , ni] = token.split('/').map((s) => (s ? parseInt(s, 10) : NaN))
    const p = (vi - 1) * 3
    g.position.push(positions[p], positions[p + 1], positions[p + 2])
    if (!Number.isNaN(ni)) { const n = (ni - 1) * 3; g.normal.push(normals[n], normals[n + 1], normals[n + 2]) }
    else g.normal.push(0, 1, 0)
    idx = g.position.length / 3 - 1
    g.map.set(token, idx)
    return idx
  }
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (t.startsWith('v ')) { const [, x, y, z] = t.split(/\s+/); positions.push(+x, +y, +z) }
    else if (t.startsWith('vn ')) { const [, x, y, z] = t.split(/\s+/); normals.push(+x, +y, +z) }
    else if (t.startsWith('usemtl ')) cur = t.slice(7).trim()
    else if (t.startsWith('f ')) {
      const toks = t.split(/\s+/).slice(1)
      const g = groupFor(cur)
      const vs = toks.map((tk) => vert(g, tk))
      for (let i = 1; i < vs.length - 1; i++) g.index.push(vs[0], vs[i], vs[i + 1])
    }
  }
  return groups
}

fs.mkdirSync(OUT_DIR, { recursive: true })
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

for (const n of [1, 2, 3]) {
  const objPath = path.join(OBJ_DIR, `Necklace${n}.obj`)
  const groups = parseObj(fs.readFileSync(objPath, 'utf8'))

  // Centre the mesh on its own origin so the registry neck transform places a
  // predictable pivot (the pack authors each necklace off-centre).
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const g of groups.values()) for (let i = 0; i < g.position.length; i += 3)
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], g.position[i + k]); hi[k] = Math.max(hi[k], g.position[i + k]) }
  const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2)
  for (const g of groups.values()) for (let i = 0; i < g.position.length; i += 3)
    for (let k = 0; k < 3; k++) g.position[i + k] -= c[k]

  const doc = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene()
  const mesh = doc.createMesh(`necklace${n}`)
  for (const [matName, g] of groups) {
    if (!g.index.length) continue
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.position)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.normal)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(g.index)).setBuffer(buffer))
    const mat = doc.createMaterial(`steel_${matName}`) // 'steel' so the legacy
      // name-scoped tint path also catches it; neck tints allMaterials anyway
      .setBaseColorFactor(GREY[matName] || DEFAULT_GREY)
      .setRoughnessFactor(0.35).setMetallicFactor(0.6)
    prim.setMaterial(mat)
    mesh.addPrimitive(prim)
  }
  const node = doc.createNode(`necklace${n}`).setMesh(mesh)
  scene.addChild(node)
  await doc.transform(dedup(), prune())

  const out = path.join(OUT_DIR, `necklace${n}.glb`)
  await io.write(out, doc)
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} KiB, ${groups.size} mats)`)
}
