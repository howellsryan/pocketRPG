#!/usr/bin/env node
// Builds world/client/public/models/hero.glb from the same Quaternius base
// character + default outfit as scripts/build-arena-hero.mjs (item 12 —
// "open-world hero must match the combat-arena hero"): the Universal Base
// Character "Superhero_Male_FullBody" body (65-joint universal rig) with the
// Modular Fantasy Peasant outfit baked in as the default clothed look, same
// technique as the arena script (merge outfit-part meshes, remap their skins
// onto the base skeleton by joint name). Only the clip set differs — the
// world keeps its own animation states (§5 EntityDiff.anim) rather than the
// arena's combat-focused clips, retargeted onto this body exactly as before.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { mergeDocuments, prune, dedup, resample, unpartition, textureCompress } from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const qRoot = path.join(repoRoot, 'assets', 'open-world', 'Quaternius')
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
// Same default clothed look as the arena hero — no Arms piece so equipped
// bracers/sleeves never fight baked cloth on the forearms.
const OUTFIT_PARTS = ['Male_Peasant_Body.gltf', 'Male_Peasant_Legs.gltf', 'Male_Peasant_Feet.gltf']
const OUT = path.join(worldDir, 'client', 'public', 'models', 'hero.glb')

const CLIPS = [
  { file: UAL1, clip: 'Idle_Loop', as: 'idle' },
  { file: UAL1, clip: 'Walk_Loop', as: 'walk' },
  { file: UAL1, clip: 'Jog_Fwd_Loop', as: 'run' },
  { file: UAL2, clip: 'TreeChopping_Loop', as: 'mine' },
  { file: UAL1, clip: 'Sword_Attack', as: 'attack' },
  // No bow-draw clip exists in either UAL pack; Pistol_Shoot is the only
  // ranged-fire animation (arm extended forward, weapon loosed) — reads as a
  // ranged attack even though it's pistol-posed rather than a bow draw.
  // Spell_Simple_Shoot is a genuine magic-cast clip.
  { file: UAL1, clip: 'Pistol_Shoot', as: 'attack_ranged' },
  { file: UAL1, clip: 'Spell_Simple_Shoot', as: 'attack_magic' },
  { file: UAL1, clip: 'Death01', as: 'die' },
]

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

// The pack's .gltf references two texture URIs with a stray `_png` suffix
// (T_Hair_1_Normal_png.png, T_Eye_Normal_png.png) that don't exist on disk —
// the real files do, minus the suffix (same fix as build-arena-hero.mjs).
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

// Merge each outfit part (skinned to the same universal rig) into the base
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
    // Channels + samplers must go too — disposing only the animation leaves
    // them (and their accessors) reachable, and mergeDocuments copies it all.
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

// The pack ships 4K PBR maps (~66 MiB total). At this game's camera distance
// only base color matters: drop normal/ORM/roughness maps and shrink the rest.
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
