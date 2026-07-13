#!/usr/bin/env node
// Builds public/3d-samples/hero.glb — the arena/equip-screen hero — from the
// Quaternius packs in assets/open-world/Quaternius: the Universal Base
// Characters "Superhero_Male_FullBody" body (65-joint universal rig), the
// Modular Fantasy Peasant outfit baked in as the default clothed look (same
// rig — its skins are remapped onto the body's joints, and the runtime
// hide-mask cuts it away region-by-region when armour overlays it), plus a
// curated set of Universal Animation Library clips merged onto it by joint
// name (same rig family, so no retargeting). Clip names are lowercased to
// match src/data/equipmentModels.json `character` (idle_loop, sword_attack,
// sword_regular_combo, hit_chest, death01).
//
// Run: node scripts/build-arena-hero.mjs
// Sibling of world/scripts/build-hero.mjs (the open-world hero); kept separate
// because the arena wants a different body, clip set, and output path.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { mergeDocuments, prune, dedup, resample, unpartition, textureCompress } from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer'
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
const UAL1 = path.join(
  qRoot, 'Universal Animation Library[Standard] (1)', 'Universal Animation Library[Standard]', 'Unreal-Godot', 'UAL1_Standard.glb'
)
const UAL2 = path.join(
  qRoot, 'Universal Animation Library 2[Standard]', 'Universal Animation Library 2[Standard]', 'Unreal-Godot', 'UAL2_Standard.glb'
)
const OUTFIT_PARTS_DIR = path.join(
  qRoot,
  'Modular Character Outfits - Fantasy[Standard]', 'Modular Character Outfits - Fantasy[Standard]',
  'Exports', 'glTF (Godot-Unreal)', 'Modular Parts'
)
// Default clothed look — no Arms piece so equipped bracers/sleeves never
// fight baked cloth on the forearms.
const OUTFIT_PARTS = ['Male_Peasant_Body.gltf', 'Male_Peasant_Legs.gltf', 'Male_Peasant_Feet.gltf']
const OUT = path.join(ROOT, 'public', '3d-samples', 'hero.glb')

const CLIPS = [
  { file: UAL1, clip: 'Idle_Loop', as: 'idle_loop' },
  // Weapon-drawn ready stance (blade held forward) — used instead of
  // idle_loop's relaxed fists-at-side pose whenever the hero has a weapon
  // equipped, so an attached weapon reads as "in hand, ready" rather than
  // resting oddly against a relaxed arm.
  { file: UAL1, clip: 'Sword_Idle', as: 'combat_idle' },
  { file: UAL1, clip: 'Sword_Attack', as: 'sword_attack' },
  { file: UAL2, clip: 'Sword_Regular_Combo', as: 'sword_regular_combo' },
  { file: UAL1, clip: 'Hit_Chest', as: 'hit_chest' },
  { file: UAL1, clip: 'Death01', as: 'death01' },
]

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

// The pack's .gltf references two texture URIs with a stray `_png` suffix
// (T_Hair_1_Normal_png.png, T_Eye_Normal_png.png) that don't exist on disk —
// the real files do, minus the suffix. Load resources by hand so the URIs can
// be fixed without touching the checked-in pack.
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

const doc = await readGltfWithPatchedUris(CHARACTER)
const baseNodes = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]))
const baseScene = doc.getRoot().listScenes()[0]

// Merge an outfit-part glTF (skinned to the same universal rig) into the base
// character: move its mesh nodes into the base scene and rebuild each skin
// over the base skeleton's joints (matched by name), then drop the part's own
// duplicate skeleton. Same-rig bind poses make this a pure joint remap.
for (const partFile of OUTFIT_PARTS) {
  const src = await readGltfWithPatchedUris(path.join(OUTFIT_PARTS_DIR, partFile))
  const scenesBefore = new Set(doc.getRoot().listScenes())
  mergeDocuments(doc, src)
  const mergedScenes = doc.getRoot().listScenes().filter((s) => !scenesBefore.has(s))
  for (const scene of mergedScenes) {
    const nodes = []
    scene.traverse((n) => nodes.push(n))
    for (const node of nodes) {
      if (!node.getMesh()) continue
      const oldSkin = node.getSkin()
      if (oldSkin) {
        const skin = doc.createSkin(node.getName() + '_skin')
        for (const joint of oldSkin.listJoints()) {
          const baseJoint = baseNodes.get(joint.getName())
          if (!baseJoint) throw new Error(`${partFile}: no base joint named '${joint.getName()}'`)
          skin.addJoint(baseJoint)
        }
        skin.setInverseBindMatrices(oldSkin.getInverseBindMatrices())
        node.setSkin(skin)
      }
      baseScene.addChild(node)
    }
    const leftovers = []
    scene.traverse((n) => leftovers.push(n))
    scene.dispose()
    for (const n of leftovers) n.dispose()
  }
}

for (const spec of CLIPS) {
  const src = await io.read(spec.file)
  for (const anim of src.getRoot().listAnimations()) {
    if (anim.getName() === spec.clip) continue
    for (const channel of anim.listChannels()) channel.dispose()
    for (const sampler of anim.listSamplers()) sampler.dispose()
    anim.dispose()
  }
  await src.transform(prune())
  mergeDocuments(doc, src)
  const merged = doc.getRoot().listAnimations().find((a) => a.getName() === spec.clip)
  if (!merged) throw new Error(`clip ${spec.clip} not found in ${spec.file}`)
  merged.setName(spec.as)
  for (const channel of merged.listChannels()) {
    const target = channel.getTargetNode()
    if (!target) continue
    const baseNode = baseNodes.get(target.getName())
    if (!baseNode) throw new Error(`clip ${spec.as}: no hero joint named '${target.getName()}'`)
    channel.setTargetNode(baseNode)
  }
}

for (const scene of doc.getRoot().listScenes()) {
  if (scene === baseScene) continue
  const nodes = []
  scene.traverse((n) => nodes.push(n))
  scene.dispose()
  for (const n of nodes) n.dispose()
}

// 2K PBR maps are wasted at arena camera distance: keep base color only.
for (const material of doc.getRoot().listMaterials()) {
  material.setNormalTexture(null)
  material.setOcclusionTexture(null)
  material.setMetallicRoughnessTexture(null)
  material.setRoughnessFactor(1)
  material.setMetallicFactor(0)
}
await doc.transform(
  resample(),
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
  unpartition()
)
await io.write(OUT, doc)

const clips = doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KiB) clips: ${clips}`)
