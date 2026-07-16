#!/usr/bin/env node
// Builds public/3d-samples/shields/q_shield.glb — one grey-base shield GLB for
// the arena/equip-screen hero, from the Quaternius Fantasy Props wooden shield.
// Same tint-per-tier discipline as the weapon build
// (scripts/build-quaternius-weapons.mjs): the source's textured wood/metal/trim
// materials are baked to a neutral grey ladder and renamed to include "Steel"
// so the registry per-tier `tint` (heroAttach.applyEquipTint, which tints
// /steel/i materials) recolours bronze → runeforged from this single file. The
// shield attaches to the hero's `hand_l` bone via one canonical
// defaults.gear.shield transform in src/data/equipmentModels.json.
//
// Run: node scripts/build-quaternius-shields.mjs
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup, unpartition } from '@gltf-transform/functions'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(
  ROOT, 'assets', 'open-world', 'Quaternius',
  'Fantasy Props Mega Kit', 'Shield_Wooden.gltf'
)
const OUT_DIR = path.join(ROOT, 'public', '3d-samples', 'shields')

// Grey ladder keyed by source material — keeps the boss/rim/face reading as
// distinct depths after the per-tier tint multiply.
const GREYS = {
  MI_Trim_Metal_Vertex: 0.82, // raised boss + rim band (brightest)
  MI_Trim_Furniture: 0.55, // wood face
  MI_Trim_Props: 0.42, // studs / straps (darkest)
}
const DEFAULT_GREY = 0.6

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(SRC)

for (const mat of doc.getRoot().listMaterials()) {
  const g = GREYS[mat.getName()] ?? DEFAULT_GREY
  mat
    .setBaseColorTexture(null)
    .setBaseColorFactor([g, g, g, 1])
    .setMetallicRoughnessTexture(null)
    .setNormalTexture(null)
    .setOcclusionTexture(null)
    .setEmissiveTexture(null)
    .setRoughnessFactor(0.55)
    .setMetallicFactor(0)
    // renamed so heroAttach.applyEquipTint (default: tints /steel/i materials)
    // recolours the whole shield per tier
    .setName(mat.getName() + '_Steel')
}

await doc.transform(dedup(), prune(), unpartition())

fs.mkdirSync(OUT_DIR, { recursive: true })
// Emit a self-contained .gltf (buffer inlined as a data URI) rather than a
// binary .glb: the whole model is then UTF-8 text, which keeps it diffable and
// portable across text-only asset channels. GLTFLoader loads it identically to
// a .glb. Textures are already stripped above, so there is only one buffer to
// inline.
const { json, resources } = await io.writeJSON(doc, { format: 'GLTF' })
for (const buffer of json.buffers || []) {
  if (buffer.uri && resources[buffer.uri]) {
    const b64 = Buffer.from(resources[buffer.uri]).toString('base64')
    buffer.uri = 'data:application/octet-stream;base64,' + b64
  }
}
const file = path.join(OUT_DIR, 'q_shield.gltf')
fs.writeFileSync(file, JSON.stringify(json))
console.log(`wrote ${file} (${(fs.statSync(file).size / 1024).toFixed(1)} KiB)`)
