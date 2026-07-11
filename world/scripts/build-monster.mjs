#!/usr/bin/env node
// Builds monster GLBs from the Quaternius Ultimate Monsters Bundle the same way
// build-cow.mjs does: keep + rename only the clips the protocol needs
// (idle/walk/die — npc attack anims are never broadcast), drop the rest, and
// print the static world bounds the client registry needs (Box3.setFromObject
// is unreliable for skinned meshes, so bounds are baked as constants).
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup, resample, getBounds } from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const BUNDLE = path.join(repoRoot, 'assets', 'open-world', 'Quaternius', 'Ultimate Monsters Bundle-glb')
const MODELS = path.join(worldDir, 'client', 'public', 'models')

// The goleling has no ground clips — it flies (Flying_Idle / Fast_Flying).
const BUILDS = [
  { src: 'Chicken.glb', out: 'chicken.glb', clips: { Idle: 'idle', Walk: 'walk', Death: 'die' } },
  { src: 'Goleling.glb', out: 'goblin.glb', clips: { Flying_Idle: 'idle', Fast_Flying: 'walk', Death: 'die' } },
  { src: 'Wizard.glb', out: 'wizard.glb', clips: { Idle: 'idle', Walk: 'walk', Death: 'die' } },
]

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

for (const { src, out, clips } of BUILDS) {
  const doc = await io.read(path.join(BUNDLE, src))
  const keep = new Map()
  for (const anim of doc.getRoot().listAnimations()) {
    const name = anim.getName()
    const spec = Object.entries(clips).find(([clip]) => name === clip || name.endsWith(`|${clip}`))
    if (spec && !keep.has(spec[1])) {
      keep.set(spec[1], anim)
    } else {
      for (const channel of anim.listChannels()) channel.dispose()
      for (const sampler of anim.listSamplers()) sampler.dispose()
      anim.dispose()
    }
  }
  for (const [as, anim] of keep) anim.setName(as)
  for (const as of ['idle', 'walk', 'die']) {
    if (!keep.has(as)) throw new Error(`clip for '${as}' not found in ${src}`)
  }
  await doc.transform(resample(), dedup(), prune())
  const outPath = path.join(MODELS, out)
  await io.write(outPath, doc)
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  const b = getBounds(scene)
  console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KiB)`)
  console.log(`  bounds min [${b.min.map((v) => v.toFixed(2))}] max [${b.max.map((v) => v.toFixed(2))}]`)
}
