#!/usr/bin/env node
// Builds world/client/public/models/hero.glb from the Quaternius library in
// assets/open-world: the Modular Fantasy "Male_Ranger" outfit character (the
// Universal Base Character body with the ranger outfit pre-fitted, 65-joint
// universal rig) + Universal Animation Library clips retargeted onto it by
// joint name and renamed to the protocol's anim states (§5 EntityDiff.anim).
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
  'Modular Character Outfits - Fantasy[Standard]', 'Modular Character Outfits - Fantasy[Standard]',
  'Exports', 'glTF (Godot-Unreal)', 'Outfits', 'Male_Ranger.gltf'
)
const UAL1 = path.join(
  qRoot, 'Universal Animation Library[Standard] (1)', 'Universal Animation Library[Standard]', 'Unreal-Godot', 'UAL1_Standard.glb'
)
const UAL2 = path.join(
  qRoot, 'Universal Animation Library 2[Standard]', 'Universal Animation Library 2[Standard]', 'Unreal-Godot', 'UAL2_Standard.glb'
)
const OUT = path.join(worldDir, 'client', 'public', 'models', 'hero.glb')

const CLIPS = [
  { file: UAL1, clip: 'Idle_Loop', as: 'idle' },
  { file: UAL1, clip: 'Walk_Loop', as: 'walk' },
  { file: UAL2, clip: 'TreeChopping_Loop', as: 'mine' },
  { file: UAL1, clip: 'Sword_Attack', as: 'attack' },
  { file: UAL1, clip: 'Death01', as: 'die' },
]

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

const doc = await io.read(CHARACTER)
const baseNodes = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]))
const baseScene = doc.getRoot().listScenes()[0]

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
