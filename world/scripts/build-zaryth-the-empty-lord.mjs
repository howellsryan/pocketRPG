#!/usr/bin/env node
// Builds world/client/public/models/zaryth_the_empty_lord.glb from the arena's
// boss model (public/3d-samples/monsters/zaryth_the_empty_lord.glb).
//
// Same shape as build-warlord-grondar.mjs — rename the arena's clips to the
// protocol's anim states (§5 EntityDiff.anim) and drop the rest — minus the
// decimation pass: this source is already inside the world's triangle budget,
// so simplifying it would only cost silhouette on a boss the camera sits close
// to.
//
// Zaryth swings with a different clip depending on the style it is attacking
// with, and the world protocol splits ranged from magic where the arena treats
// them as one. The rig ships one clip for both, so `attack_magic` is a copy of
// `attack_ranged` rather than a missing action that would fall back to idle
// mid-cast.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup, resample, getBounds } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const SRC = path.join(repoRoot, 'public', '3d-samples', 'monsters', 'zaryth_the_empty_lord.glb')
const OUT = path.join(worldDir, 'client', 'public', 'models', 'zaryth_the_empty_lord.glb')

// No locomotion clip — makeAnimator aliases walk to idle (noLocomotionClip).
const CLIPS = [
  { clip: 'Idle', as: 'idle' },
  { clip: 'Attack', as: 'attack' },
  { clip: 'AttackRanged', as: 'attack_ranged' },
  { clip: 'Death', as: 'die' },
]
const ALIAS = [{ from: 'attack_ranged', as: 'attack_magic' }]

// The corpse is removed NPC_REMOVE_AFTER_DEATH_TICKS after death (3.6s), so a
// longer die clip is simply cut off mid-fall. This source collapses by ~3.0s
// and then spends five seconds settling, so the tail is trimmed rather than the
// world-wide linger being stretched for one monster. Keyframes only — LINEAR
// and STEP samplers both survive a slice; CUBICSPLINE would not, so it throws.
const DIE_MAX_SEC = 3.4

function trimClip(anim, maxSec) {
  // Samplers may share one input accessor, so keep counts are worked out from
  // the untrimmed times first and each accessor is sliced exactly once.
  const keepFor = new Map()
  for (const sampler of anim.listSamplers()) {
    if (sampler.getInterpolation() === 'CUBICSPLINE') throw new Error('cannot trim a CUBICSPLINE sampler')
    const input = sampler.getInput()
    if (keepFor.has(input)) continue
    const times = Array.from(input.getArray())
    keepFor.set(input, Math.max(1, times.filter((t) => t <= maxSec).length))
  }
  const done = new Set()
  for (const sampler of anim.listSamplers()) {
    const input = sampler.getInput()
    const output = sampler.getOutput()
    const keep = keepFor.get(input)
    if (keep >= input.getCount()) continue
    if (!done.has(output)) {
      output.setArray(output.getArray().slice(0, keep * output.getElementSize()))
      done.add(output)
    }
    if (!done.has(input)) {
      input.setArray(input.getArray().slice(0, keep))
      done.add(input)
    }
  }
}

await MeshoptDecoder.ready
await MeshoptEncoder.ready
// The arena source is meshopt-compressed (process-3d-model.mjs), so writing it
// back out needs the ENCODER as well as the decoder that read it.
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

const doc = await io.read(SRC)

const keep = new Map()
for (const anim of doc.getRoot().listAnimations()) {
  const name = anim.getName()
  const spec = CLIPS.find(({ clip }) => name === clip || name.endsWith(`|${clip}`))
  if (spec && !keep.has(spec.as)) {
    keep.set(spec.as, anim)
  } else {
    for (const channel of anim.listChannels()) channel.dispose()
    for (const sampler of anim.listSamplers()) sampler.dispose()
    anim.dispose()
  }
}
for (const { as } of CLIPS) {
  if (!keep.has(as)) throw new Error(`clip for '${as}' not found in ${SRC}`)
}
for (const [as, anim] of keep) anim.setName(as)
for (const { from, as } of ALIAS) {
  const copy = keep.get(from).clone()
  copy.setName(as)
  keep.set(as, copy)
}

await doc.transform(resample(), dedup(), prune())

// Trim last: resample() reads the untouched samplers, and dedup() may merge
// accessors this would otherwise slice out from under another clip.
trimClip(keep.get('die'), DIE_MAX_SEC)

await io.write(OUT, doc)

const b = getBounds(doc.getRoot().listScenes()[0])
const f = (n) => Number(n.toFixed(3))
console.log(`build-zaryth-the-empty-lord: wrote ${path.relative(repoRoot, OUT)}`)
console.log(`clips: ${[...keep.keys()].join(', ')}`)
console.log(`bounds: { minX: ${f(b.min[0])}, minY: ${f(b.min[1])}, minZ: ${f(b.min[2])}, maxX: ${f(b.max[0])}, maxY: ${f(b.max[1])}, maxZ: ${f(b.max[2])} }`)
