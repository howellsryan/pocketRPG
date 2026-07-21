#!/usr/bin/env node
// Builds public/3d-samples/outfits/*.glb — skinned armour outfits for the
// arena/equip-screen hero — from the Quaternius Modular Fantasy outfit parts.
// Each output carries the hero's full 65-joint universal skeleton (from the
// same base character scripts/build-arena-hero.mjs uses) with the outfit
// meshes remapped onto it, so the runtime rebind in heroAttach.attachGearList
// (piece skinIndex → hero skeleton bone order) lines up index-for-index and
// the piece deforms with every hero clip. Grey-ish source textures take the
// registry per-tier `tint` (bronze → runeforged) at attach time.
//
// Run: node scripts/build-quaternius-outfits.mjs
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { mergeDocuments, prune, dedup, unpartition } from '@gltf-transform/functions'
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const qRoot = path.join(ROOT, 'assets', 'open-world', 'Quaternius')
const CHARACTER = path.join(
  qRoot,
  'Universal Base Characters[Standard]', 'Universal Base Characters[Standard]',
  'Base Characters', 'Godot - UE', 'Superhero_Male_FullBody.gltf'
)
const PARTS_DIR = path.join(
  qRoot,
  'Modular Character Outfits - Fantasy[Standard]', 'Modular Character Outfits - Fantasy[Standard]',
  'Exports', 'glTF (Godot-Unreal)', 'Modular Parts'
)
const OUT_DIR = path.join(ROOT, 'public', '3d-samples', 'outfits')

const OUTFITS = [
  { out: 'ranger_body.glb', parts: ['Male_Ranger_Body.gltf', 'Male_Ranger_Arms.gltf'] },
  { out: 'ranger_legs.glb', parts: ['Male_Ranger_Legs.gltf', 'Male_Ranger_Feet_Boots.gltf'] },
  // Boots slot: just the rigged feet/boots part (same one baked into
  // ranger_legs), so an equipped boots item is a skinned mesh sharing the hero
  // skeleton — deforms with the calf/foot and layers flawlessly with platelegs.
  { out: 'ranger_boots.glb', parts: ['Male_Ranger_Feet_Boots.gltf'] },
]

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

// Same URI patch as build-arena-hero.mjs: the pack references two textures
// with a stray `_png` suffix that only exist without it.
function readGltfWithPatchedUris(gltfPath) {
  const dir = path.dirname(gltfPath)
  const json = JSON.parse(fs.readFileSync(gltfPath, 'utf8'))
  for (const img of json.images || []) {
    if (img.uri && img.uri.endsWith('_png.png') && !fs.existsSync(path.join(dir, img.uri))) {
      img.uri = img.uri.replace(/_png\.png$/, '.png')
    }
  }
  const resources = {}
  for (const uri of [
    ...(json.buffers || []).map((b) => b.uri),
    ...(json.images || []).map((i) => i.uri),
  ]) {
    if (uri && !resources[uri]) resources[uri] = fs.readFileSync(path.join(dir, decodeURIComponent(uri)))
  }
  return io.readJSON({ json, resources })
}

fs.mkdirSync(OUT_DIR, { recursive: true })

for (const { out, parts } of OUTFITS) {
  const doc = await readGltfWithPatchedUris(CHARACTER)
  const baseScene = doc.getRoot().listScenes()[0]
  const baseSkin = doc.getRoot().listSkins()[0]
  const baseJointIdx = new Map(baseSkin.listJoints().map((j, i) => [j.getName(), i]))

  // drop the base character's own meshes — output is skeleton + outfit only
  for (const node of doc.getRoot().listNodes()) {
    if (node.getMesh()) node.setMesh(null)
  }
  for (const mesh of doc.getRoot().listMeshes()) mesh.dispose()

  for (const partFile of parts) {
    const src = await readGltfWithPatchedUris(path.join(PARTS_DIR, partFile))
    const scenesBefore = new Set(doc.getRoot().listScenes())
    mergeDocuments(doc, src)
    const mergedScenes = doc.getRoot().listScenes().filter((s) => !scenesBefore.has(s))
    for (const scene of mergedScenes) {
      const nodes = []
      scene.traverse((n) => nodes.push(n))
      for (const node of nodes) {
        if (!node.getMesh()) continue
        const partSkin = node.getSkin()
        if (partSkin) {
          // rewrite skinIndex values from the part's joint order to the base
          // skeleton's, then share the base skin outright
          const remap = partSkin.listJoints().map((j) => {
            const idx = baseJointIdx.get(j.getName())
            if (idx === undefined) throw new Error(`${partFile}: no base joint named '${j.getName()}'`)
            return idx
          })
          for (const prim of node.getMesh().listPrimitives()) {
            const joints = prim.getAttribute('JOINTS_0')
            if (!joints) continue
            const arr = joints.getArray().slice()
            for (let i = 0; i < arr.length; i++) arr[i] = remap[arr[i]]
            joints.setArray(arr)
          }
          node.setSkin(baseSkin)
        }
        baseScene.addChild(node)
      }
      const leftovers = []
      scene.traverse((n) => leftovers.push(n))
      scene.dispose()
      for (const n of leftovers) n.dispose()
    }
  }

  for (const material of doc.getRoot().listMaterials()) {
    material.setNormalTexture(null)
    material.setOcclusionTexture(null)
    material.setMetallicRoughnessTexture(null)
    material.setRoughnessFactor(1)
    material.setMetallicFactor(0)
  }
  await doc.transform(dedup(), prune(), unpartition())
  // Near-greyscale the base colour maps so the registry per-tier tint owns
  // the hue — the source leathers are strongly green/brown and a multiply
  // tint can't shift them enough to tell bronze from runeforged.
  for (const texture of doc.getRoot().listTextures()) {
    const img = await sharp(Buffer.from(texture.getImage()))
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .modulate({ saturation: 0.12, brightness: 1.1 })
      .webp()
      .toBuffer()
    texture.setImage(new Uint8Array(img)).setMimeType('image/webp')
  }
  const file = path.join(OUT_DIR, out)
  await io.write(file, doc)
  console.log(`wrote ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KiB)`)
}
