#!/usr/bin/env node
// Builds public/3d-samples/capes/cape.glb — the cape-slot prop for the
// arena/equip-screen hero — from assets/open-world/cape.glb (a generic draped
// cape with its own 13-bone rig). The runtime attaches it rigidly to the hero's
// upper-spine bone in its bind-pose drape (src/data/equipmentModels.json
// defaults.gear.cape) — it is NOT rebound onto the hero skeleton (heroAttach
// gates the skinned-rebind path to body/legs outfit pieces). The whole model
// takes the per-item registry `tint` at attach time (allMaterials for cape), so
// the base colour is neutralised to white here and vertex colours are dropped so
// the tint reads true.
//
// Run: node scripts/build-cape.mjs
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, unpartition, getBounds } from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'assets', 'open-world', 'cape.glb')
const OUT_DIR = path.join(ROOT, 'public', '3d-samples', 'capes')
const OUT = path.join(OUT_DIR, 'cape.glb')

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(SRC)

for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    // Drop baked vertex colours so the multiply tint owns the hue.
    const color = prim.getAttribute('COLOR_0')
    if (color) { prim.setAttribute('COLOR_0', null); color.dispose() }
  }
}
for (const material of doc.getRoot().listMaterials()) {
  material.setBaseColorFactor([1, 1, 1, 1])
  material.setBaseColorTexture(null)
  material.setNormalTexture(null)
  material.setMetallicRoughnessTexture(null)
  material.setRoughnessFactor(0.9).setMetallicFactor(0) // cloth
  material.setDoubleSided(true) // a cape is seen from both faces
}

// Normalise into a predictable attach frame: unit height, collar-centre at the
// origin, so the registry cape transform (defaults.gear.cape) is intuitive. The
// source is authored on a ~3-unit character with its origin at the feet, so a
// raw bone attach floats the cape above the head. A wrapper node carries the
// transform (the mesh is skinned — its verts live in bind space, so we shift the
// rig, not the geometry). p → S*p + T maps top→0, centre X/Z→0, height→1.
{
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  const b = getBounds(scene)
  const h = (b.max[1] - b.min[1]) || 1
  const S = 1 / h
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2
  const wrap = doc.createNode('cape_norm').setScale([S, S, S]).setTranslation([-cx * S, -b.max[1] * S, -cz * S])
  for (const child of scene.listChildren()) { scene.removeChild(child); wrap.addChild(child) }
  scene.addChild(wrap)
}

fs.mkdirSync(OUT_DIR, { recursive: true })
await doc.transform(dedup(), prune(), unpartition())
await io.write(OUT, doc)
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KiB)`)
