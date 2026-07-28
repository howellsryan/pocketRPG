#!/usr/bin/env node
// Builds world/client/public/models/cow.glb from the Quaternius Farm Animal
// Pack. The cow is a self-contained rigged GLB (its own 28-joint skeleton, its
// own clips) — no retargeting/merging like the hero. We only rename the clips
// we use to the protocol's anim states (§5 EntityDiff.anim) and drop the rest;
// the client centres + scales it from its bounding box at load time.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup, resample } from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const SRC = path.join(repoRoot, 'assets', 'open-world', 'Quaternius', 'Farm Animal Pack-glb', 'Cow.glb')
const OUT = path.join(worldDir, 'client', 'public', 'models', 'cow.glb')

// Source clip name suffix (they ship prefixed "Armature|") → protocol anim.
const CLIPS = [
  { clip: 'Idle', as: 'idle' },
  { clip: 'Walk', as: 'walk' },
  { clip: 'Death', as: 'die' },
  // The farm pack ships no attack clip; the jump is the bull's lunge, and
  // without one it stands still while its hit splat lands on the player.
  { clip: 'Jump', as: 'attack' },
]

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

const doc = await io.read(SRC)
const keep = new Map()
for (const anim of doc.getRoot().listAnimations()) {
  const name = anim.getName()
  const spec = CLIPS.find((c) => name === c.clip || name.endsWith(`|${c.clip}`))
  if (spec && !keep.has(spec.as)) {
    keep.set(spec.as, anim)
  } else {
    for (const channel of anim.listChannels()) channel.dispose()
    for (const sampler of anim.listSamplers()) sampler.dispose()
    anim.dispose()
  }
}
for (const [as, anim] of keep) anim.setName(as)
for (const as of ['idle', 'walk', 'die']) {
  if (!keep.has(as)) throw new Error(`cow clip for '${as}' not found in ${SRC}`)
}

await doc.transform(resample(), dedup(), prune())
await io.write(OUT, doc)

const clips = doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KiB) clips: ${clips}`)
