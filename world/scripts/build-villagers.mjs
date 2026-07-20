#!/usr/bin/env node
// Builds world/client/public/models/villager_{a,b,c}.glb — human ambient-layer
// walkers replacing the animal critter models in towns (R2-9,
// docs/open-world-changes-plan.md). Follows build-hero.mjs's actual clip
// retargeting (rename + re-point each channel's target node onto the
// outfit's own joint of the same name), not a baked static pose: a bob-only
// "animation" read as broken/ridiculous for human figures (R3-4,
// docs/open-world-changes-plan.md) — ambient.ts now runs a real
// THREE.AnimationMixer per villager, crossfading Idle_Loop/Walk_Loop exactly
// like the hero and monster GLBs (entities.ts's makeAnimator).
//
// Source note: only the "Ranger" outfits in this pack are self-contained
// full characters (Head_Hood mesh included); "Peasant" is clothing-only,
// built to sit over the separate Universal Base Characters head/hair — with
// no matching head piece shipped in this pack, it renders as a headless
// stump. So both variants use a Ranger outfit (proven working — build-hero.mjs
// uses the same source for the player hero) and differentiate with gender +
// a tint on the third, rather than mixing in a different base-character pack.
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
const outfitsDir = path.join(
  qRoot, 'Modular Character Outfits - Fantasy[Standard]', 'Modular Character Outfits - Fantasy[Standard]',
  'Exports', 'glTF (Godot-Unreal)', 'Outfits'
)
const UAL1 = path.join(
  qRoot, 'Universal Animation Library[Standard] (1)', 'Universal Animation Library[Standard]', 'Unreal-Godot', 'UAL1_Standard.glb'
)

const VARIANTS = [
  { id: 'villager_a', src: path.join(outfitsDir, 'Male_Ranger.gltf'), tint: null },
  { id: 'villager_b', src: path.join(outfitsDir, 'Female_Ranger.gltf'), tint: null },
  // A third distinct look without a third full-character source: a warm
  // tan/rust dye reads clearly apart from the green-brown Ranger default.
  { id: 'villager_c', src: path.join(outfitsDir, 'Male_Ranger.gltf'), tint: [1, 0.8, 0.15] },
]

// Named 'idle'/'walk' to match entities.ts's AnimName union and makeAnimator,
// which looks clips up by exactly those names.
const CLIPS = [
  { file: UAL1, clip: 'Idle_Loop', as: 'idle' },
  { file: UAL1, clip: 'Walk_Loop', as: 'walk' },
]

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

/** Merges UAL1's idle/walk clips onto `doc`'s own joints by name (build-hero's
 * exact retarget: rename the clip, re-point each channel's target node to the
 * outfit's joint of the same name), leaving them playable — not baked — then
 * drops UAL1's own now-unused scene/nodes. */
async function retargetClips(doc) {
  const baseScene = doc.getRoot().listScenes()[0]
  const baseNodes = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]))

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
      if (!baseNode) throw new Error(`clip ${spec.as}: no villager joint named '${target.getName()}'`)
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
}

for (const variant of VARIANTS) {
  const doc = await io.read(variant.src)

  await retargetClips(doc)

  // Same "only base color matters at this camera distance" call as build-hero.
  for (const material of doc.getRoot().listMaterials()) {
    material.setNormalTexture(null)
    material.setOcclusionTexture(null)
    material.setMetallicRoughnessTexture(null)
    material.setRoughnessFactor(1)
    material.setMetallicFactor(0)
    // glTF multiplies the sampled base color texture by this factor, so a
    // flat tint needs no texture edits — just a non-white baseColorFactor.
    // Skin material is left alone; only the outfit cloth gets dyed.
    if (variant.tint && material.getName() !== 'MI_Regular_Male' && material.getName() !== 'MI_Regular_Female') {
      material.setBaseColorFactor([...variant.tint, 1])
    }
  }

  await doc.transform(
    resample(),
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512] }),
    unpartition()
  )

  const out = path.join(worldDir, 'client', 'public', 'models', `${variant.id}.glb`)
  await io.write(out, doc)
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KiB)`)
}
