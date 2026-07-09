#!/usr/bin/env node
// Builds world/client/public/models/hero.glb from the CC0 KayKit library in
// assets/open-world: the Adventurers 2.0 Knight mesh + Rig_Medium clips from
// the Character Animations pack, retargeted onto the Knight's skeleton by
// joint name and renamed to the protocol's anim states (§5 EntityDiff.anim).
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { mergeDocuments, prune, dedup, resample, unpartition } from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const assetRoot = path.join(repoRoot, 'assets', 'open-world', 'kaykit')
const CHARACTER = path.join(
  assetRoot, 'KayKit_Adventurers_2.0_FREE', 'KayKit_Adventurers_2.0_FREE', 'Characters', 'gltf', 'Knight.glb'
)
const ANIM_DIR = path.join(
  assetRoot, 'KayKit_Character_Animations_1.1', 'KayKit_Character_Animations_1.1', 'Animations', 'gltf', 'Rig_Medium'
)
const OUT = path.join(worldDir, 'client', 'public', 'models', 'hero.glb')

const CLIPS = [
  { file: 'Rig_Medium_General.glb', clip: 'Idle_A', as: 'idle' },
  { file: 'Rig_Medium_MovementBasic.glb', clip: 'Walking_A', as: 'walk' },
  { file: 'Rig_Medium_Tools.glb', clip: 'Pickaxing', as: 'mine' },
  { file: 'Rig_Medium_CombatMelee.glb', clip: 'Melee_1H_Attack_Slice_Diagonal', as: 'attack' },
  { file: 'Rig_Medium_General.glb', clip: 'Death_A', as: 'die' },
]

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

const doc = await io.read(CHARACTER)
const baseNodes = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]))
const baseScene = doc.getRoot().listScenes()[0]

for (const spec of CLIPS) {
  const src = await io.read(path.join(ANIM_DIR, spec.file))
  for (const anim of src.getRoot().listAnimations()) {
    if (anim.getName() !== spec.clip) anim.dispose()
  }
  mergeDocuments(doc, src)
  const merged = doc.getRoot().listAnimations().find((a) => a.getName() === spec.clip)
  if (!merged) throw new Error(`clip ${spec.clip} not found in ${spec.file}`)
  merged.setName(spec.as)
  for (const channel of merged.listChannels()) {
    const target = channel.getTargetNode()
    if (!target) continue
    const baseNode = baseNodes.get(target.getName())
    if (!baseNode) throw new Error(`clip ${spec.as}: no Knight joint named '${target.getName()}'`)
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

await doc.transform(resample(), dedup(), prune(), unpartition())
await io.write(OUT, doc)

const clips = doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KiB) clips: ${clips}`)
