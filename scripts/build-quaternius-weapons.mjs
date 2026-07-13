#!/usr/bin/env node
// Builds public/3d-samples/weapons/q_*.glb — one grey-base GLB per weapon
// archetype — from the Quaternius Ultimate RPG Items OBJ exports. The OBJs
// are authored grip-at-origin, blade up +y, so the only baked normalisation
// is a world scale (stylised pack units → hero metres); one canonical
// defaults.weapon transform in src/data/equipmentModels.json then fits every
// archetype. Steel materials are baked to a neutral grey ladder so the
// registry per-tier `tint` (heroAttach.applyEquipTint) recolours bronze →
// runeforged from the same file; wood/other materials keep their MTL colours.
//
// Run: node scripts/build-quaternius-weapons.mjs
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup } from '@gltf-transform/functions'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(
  ROOT, 'assets', 'open-world', 'Quaternius',
  'Ultimate RPG Items Pack - Aug 2019-20260709T194650Z-2-001', 'Ultimate RPG Items Pack - Aug 2019', 'OBJ'
)
const OUT_DIR = path.join(ROOT, 'public', '3d-samples', 'weapons')

const WORLD_SCALE = 0.5 // pack units → hero metres (sword 2.3u → ~1.15m)

const ARCHETYPES = [
  { obj: 'Sword', out: 'q_sword.glb' },
  { obj: 'Sword_big', out: 'q_sword_big.glb' },
  { obj: 'Dagger', out: 'q_dagger.glb' },
  { obj: 'Axe_small', out: 'q_axe_small.glb' },
  { obj: 'Axe_Double', out: 'q_axe_double.glb' },
  { obj: 'Hammer_Double', out: 'q_hammer_double.glb' },
  { obj: 'Bow_Wooden', out: 'q_bow.glb' },
]

// Neutral grey ladder for tintable steel; preserves the light/dark shading
// the tint multiply then recolours.
const STEEL_GREYS = { LightSteel: 0.85, Steel: 0.62, DarkSteel: 0.38 }

function parseMtl(file) {
  const mats = {}
  let cur = null
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim().split(/\s+/)
    if (t[0] === 'newmtl') { cur = t[1]; mats[cur] = { kd: [0.8, 0.8, 0.8] } }
    else if (t[0] === 'Kd' && cur) mats[cur].kd = t.slice(1, 4).map(Number)
  }
  return mats
}

// Minimal OBJ parser for the pack's exports: v / vn / usemtl / f (tri or quad,
// v//vn indexing), one primitive per material.
function parseObj(file) {
  const v = [], vn = [], groups = new Map()
  let cur = 'default'
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim().split(/\s+/)
    if (t[0] === 'v') v.push(t.slice(1, 4).map(Number))
    else if (t[0] === 'vn') vn.push(t.slice(1, 4).map(Number))
    else if (t[0] === 'usemtl') cur = t[1]
    else if (t[0] === 'f') {
      if (!groups.has(cur)) groups.set(cur, [])
      const corners = t.slice(1).map((c) => {
        const [vi, , ni] = c.split('/')
        return [Number(vi) - 1, ni ? Number(ni) - 1 : -1]
      })
      const faces = groups.get(cur)
      for (let i = 2; i < corners.length; i++) faces.push([corners[0], corners[i - 1], corners[i]])
    }
  }
  return { v, vn, groups }
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
fs.mkdirSync(OUT_DIR, { recursive: true })

for (const { obj, out } of ARCHETYPES) {
  const { v, vn, groups } = parseObj(path.join(SRC, obj + '.obj'))
  const mtl = parseMtl(path.join(SRC, obj + '.mtl'))

  const doc = new Document()
  const buffer = doc.createBuffer()
  const mesh = doc.createMesh(obj)
  for (const [matName, faces] of groups) {
    // re-index per (position, normal) pair
    const key2idx = new Map(), pos = [], nrm = [], idx = []
    for (const face of faces) {
      for (const [vi, ni] of face) {
        const key = vi + '/' + ni
        let i = key2idx.get(key)
        if (i === undefined) {
          i = pos.length / 3
          key2idx.set(key, i)
          pos.push(v[vi][0] * WORLD_SCALE, v[vi][1] * WORLD_SCALE, v[vi][2] * WORLD_SCALE)
          const n = ni >= 0 ? vn[ni] : [0, 1, 0]
          nrm.push(n[0], n[1], n[2])
        }
        idx.push(i)
      }
    }
    const grey = Object.entries(STEEL_GREYS).find(([name]) => matName.includes(name))
    const kd = grey ? [grey[1], grey[1], grey[1]] : (mtl[matName] ? mtl[matName].kd : [0.8, 0.8, 0.8])
    const material = doc.createMaterial(matName)
      .setBaseColorFactor([...kd, 1])
      .setRoughnessFactor(grey ? 0.55 : 0.9)
      .setMetallicFactor(0)
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer))
      .setMaterial(material)
    mesh.addPrimitive(prim)
  }
  const node = doc.createNode(obj).setMesh(mesh)
  doc.createScene(obj).addChild(node)
  await doc.transform(dedup(), prune())
  const file = path.join(OUT_DIR, out)
  await io.write(file, doc)
  console.log(`wrote ${file} (${(fs.statSync(file).size / 1024).toFixed(1)} KiB)`)
}
